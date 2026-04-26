import type { Address } from "viem";
import {
  clearRecipientHistory,
  loadRecipientHistoryEntries,
  loadKnownRecipientHistory,
  removeRecipientHistoryEntry,
  rememberKnownRecipient,
  upsertRecipientHistoryEntry,
  type RecipientHistoryEntry,
} from "../../services/recipient-history.js";
import {
  getWorkflowStatus,
  listSavedWorkflowIds,
} from "../../services/workflow.js";
import {
  assertSafeRecipientAddress,
  isKnownRecipient,
  newRecipientWarning,
  type RecipientSafetyWarning,
} from "../../utils/recipient-safety.js";
import { promptCancelledError } from "../../utils/errors.js";
import {
  CONFIRMATION_TOKENS,
  confirmActionWithSeverity,
  confirmPrompt,
} from "../../utils/prompts.js";
import { ensurePromptInteractionAvailable } from "../../utils/prompt-cancellation.js";
import { resolveSafeRecipientAddressOrEns } from "../../utils/recipient-safety.js";
import type { Command } from "commander";
import type { GlobalOptions } from "../../types.js";
import { resolveGlobalMode } from "../../utils/mode.js";
import { printError } from "../../utils/errors.js";
import {
  createOutputContext,
  guardCsvUnsupported,
  isSilent,
  printJsonSuccess,
  success,
  info,
} from "../../output/common.js";
import {
  formatKeyValueRows,
  formatSectionHeading,
} from "../../output/layout.js";
import { formatAddress } from "../../utils/format.js";

export function validateRecipientAddressOrEnsInput(value: string): true | string {
  const trimmed = value.trim();
  try {
    assertSafeRecipientAddress(trimmed as `0x${string}`, "Recipient");
    return true;
  } catch (error) {
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(trimmed)) {
      return true;
    }
    return error instanceof Error ? error.message : "Invalid address or ENS name.";
  }
}

export async function confirmRecipientIfNew(params: {
  address: string;
  knownRecipients: readonly string[];
  skipPrompts: boolean;
  silent: boolean;
}): Promise<RecipientSafetyWarning[]> {
  if (isKnownRecipient(params.address, params.knownRecipients)) {
    return [];
  }

  const warning = newRecipientWarning(params.address);
  if (params.skipPrompts) {
    return [warning];
  }

  ensurePromptInteractionAvailable();
  const ok = await confirmActionWithSeverity({
    severity: "standard",
    standardMessage: "Use this new recipient?",
    highStakesToken: CONFIRMATION_TOKENS.recipient,
    highStakesWarning: "Recipient review changed while waiting for confirmation.",
    confirm: confirmPrompt,
  });
  if (!ok) {
    throw promptCancelledError();
  }
  return [];
}

export function collectKnownWorkflowRecipients(): string[] {
  const recipients: string[] = [];
  for (const workflowId of listSavedWorkflowIds()) {
    try {
      const snapshot = getWorkflowStatus({ workflowId });
      if (snapshot.recipient) recipients.push(snapshot.recipient);
      if (snapshot.walletAddress) recipients.push(snapshot.walletAddress);
    } catch {
      // Ignore unreadable workflow files during transaction preflight. The
      // dedicated flow commands report workflow state strictly when requested.
    }
  }
  return recipients;
}

export function collectKnownWithdrawalRecipients(
  signerAddress: Address | null,
): string[] {
  return [
    ...(signerAddress ? [signerAddress] : []),
    ...loadKnownRecipientHistory(),
    ...collectKnownWorkflowRecipients(),
  ];
}

export function rememberSuccessfulWithdrawalRecipient(
  address: string,
  metadata: {
    ensName?: string | null;
    chain?: string | null;
    label?: string | null;
  } = {},
): void {
  try {
    if (
      metadata.ensName !== undefined ||
      metadata.chain !== undefined ||
      metadata.label !== undefined
    ) {
      rememberKnownRecipient(address, metadata);
    } else {
      rememberKnownRecipient(address);
    }
  } catch {
    // Best effort only. The withdrawal result should not fail because the
    // advisory recipient-history cache could not be updated.
  }
}

interface RecipientCommandOptions {
  label?: string;
}

function rootOptionsForCommand(cmd: Command): GlobalOptions {
  let current: Command = cmd;
  while (current.parent) {
    current = current.parent;
  }
  return current.opts() as GlobalOptions;
}

function recipientCommandPrefix(cmd: Command): string {
  const path: string[] = [];
  let current: Command | undefined = cmd;
  while (current?.parent) {
    path.unshift(current.name());
    current = current.parent;
  }
  return path[0] === "withdraw" ? "withdraw recipients" : "recipients";
}

function recipientCommandPath(cmd: Command, suffix?: string): string {
  return [recipientCommandPrefix(cmd), suffix].filter(Boolean).join(" ");
}

function recipientPayload(entry: RecipientHistoryEntry): Record<string, unknown> {
  return {
    address: entry.address,
    label: entry.label ?? null,
    ensName: entry.ensName ?? null,
    chain: entry.chain ?? null,
    source: entry.source,
    useCount: entry.useCount,
    firstUsedAt: entry.firstUsedAt,
    lastUsedAt: entry.lastUsedAt,
    updatedAt: entry.updatedAt,
  };
}

function renderRecipientList(
  entries: readonly RecipientHistoryEntry[],
  cmd: Command,
): void {
  const mode = resolveGlobalMode(rootOptionsForCommand(cmd));
  const ctx = createOutputContext(mode);
  const commandPrefix = recipientCommandPrefix(cmd);
  try {
    guardCsvUnsupported(ctx, commandPrefix);
    if (mode.isJson) {
      printJsonSuccess({
        mode: "recipient-history",
        operation: "list",
        count: entries.length,
        recipients: entries.map(recipientPayload),
      });
      return;
    }

    if (isSilent(ctx)) return;
    if (entries.length === 0) {
      info("No remembered withdrawal recipients yet.", false);
      info(`Successful withdrawals are added automatically; use '${commandPrefix} add <address>' to add one manually.`, false);
      return;
    }

    process.stderr.write(formatSectionHeading("Withdrawal recipients", { divider: true }));
    for (const entry of entries) {
      const title = entry.label
        ? `${entry.label} (${formatAddress(entry.address)})`
        : formatAddress(entry.address);
      process.stderr.write(`${title}\n`);
      process.stderr.write(
        formatKeyValueRows([
          { label: "Address", value: entry.address },
          ...(entry.ensName ? [{ label: "ENS", value: entry.ensName }] : []),
          ...(entry.chain ? [{ label: "Chain", value: entry.chain }] : []),
          { label: "Source", value: entry.source },
          { label: "Uses", value: String(entry.useCount) },
          ...(entry.lastUsedAt
            ? [{ label: "Last used", value: entry.lastUsedAt }]
            : []),
        ]),
      );
    }
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handleWithdrawRecipientsListCommand(
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  renderRecipientList(loadRecipientHistoryEntries(), cmd);
}

export async function handleWithdrawRecipientsAddCommand(
  addressOrEns: string,
  positionalLabel: string | undefined,
  opts: RecipientCommandOptions,
  cmd: Command,
): Promise<void> {
  const mode = resolveGlobalMode(rootOptionsForCommand(cmd));
  const ctx = createOutputContext(mode);
  try {
    guardCsvUnsupported(ctx, recipientCommandPath(cmd, "add"));
    const resolved = await resolveSafeRecipientAddressOrEns(
      addressOrEns,
      "Recipient",
    );
    const entry = upsertRecipientHistoryEntry({
      address: resolved.address,
      ensName: resolved.ensName,
      label: opts.label ?? positionalLabel,
      source: "manual",
    });

    if (mode.isJson) {
      printJsonSuccess({
        mode: "recipient-history",
        operation: "add",
        recipient: recipientPayload(entry),
      });
      return;
    }

    if (!isSilent(ctx)) {
      success(`Remembered recipient ${formatAddress(entry.address)}.`, false);
    }
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handleWithdrawRecipientsRemoveCommand(
  addressOrEns: string,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const mode = resolveGlobalMode(rootOptionsForCommand(cmd));
  const ctx = createOutputContext(mode);
  try {
    guardCsvUnsupported(ctx, recipientCommandPath(cmd, "remove"));
    const resolved = await resolveSafeRecipientAddressOrEns(
      addressOrEns,
      "Recipient",
    );
    const removed = removeRecipientHistoryEntry(resolved.address);

    if (mode.isJson) {
      printJsonSuccess({
        mode: "recipient-history",
        operation: "remove",
        address: resolved.address,
        removed,
      });
      return;
    }

    if (!isSilent(ctx)) {
      if (removed) {
        success(`Removed recipient ${formatAddress(resolved.address)}.`, false);
      } else {
        info(`Recipient ${formatAddress(resolved.address)} was not remembered.`, false);
      }
    }
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handleWithdrawRecipientsClearCommand(
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const mode = resolveGlobalMode(rootOptionsForCommand(cmd));
  const ctx = createOutputContext(mode);
  try {
    guardCsvUnsupported(ctx, recipientCommandPath(cmd, "clear"));
    const removedCount = clearRecipientHistory();

    if (mode.isJson) {
      printJsonSuccess({
        mode: "recipient-history",
        operation: "clear",
        removedCount,
      });
      return;
    }

    if (!isSilent(ctx)) {
      success(`Cleared ${removedCount} remembered recipient(s).`, false);
    }
  } catch (error) {
    printError(error, mode.isJson);
  }
}
