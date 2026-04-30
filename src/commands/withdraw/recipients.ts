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
import { loadConfig } from "../../services/config.js";
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
import { inputError } from "../../utils/errors/factories.js";
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
  appendNextActions,
  createNextAction,
  createOutputContext,
  guardCsvUnsupported,
  isSilent,
  printCsv,
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
  chain?: string | null,
): string[] {
  return [
    ...(signerAddress ? [signerAddress] : []),
    ...loadKnownRecipientHistory(chain),
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
  limit?: string;
  allChains?: boolean;
  includeMetadata?: boolean;
}

interface RecipientListCommandOptions {
  limit?: string;
  allChains?: boolean;
  includeMetadata?: boolean;
}

function rootOptionsForCommand(cmd: Command): GlobalOptions {
  let current: Command = cmd;
  while (current.parent) {
    current = current.parent;
  }
  return current.opts() as GlobalOptions;
}

function recipientCommandPrefix(cmd: Command): string {
  void cmd;
  return "recipients";
}

function recipientCommandPath(cmd: Command, suffix?: string): string {
  return [recipientCommandPrefix(cmd), suffix].filter(Boolean).join(" ");
}

function recipientCommandChain(
  cmd: Command,
  opts: { allChains?: boolean } = {},
): string | undefined {
  if (opts.allChains) return undefined;
  const rootOptions = rootOptionsForCommand(cmd);
  const chain = rootOptions.chain?.trim();
  if (chain) return chain.toLowerCase();
  try {
    return loadConfig().defaultChain.toLowerCase();
  } catch {
    return "mainnet";
  }
}

function recipientPayload(
  entry: RecipientHistoryEntry,
  options: { includeMetadata?: boolean } = {},
): Record<string, unknown> {
  return {
    address: entry.address,
    label: entry.label ?? null,
    ensName: entry.ensName ?? null,
    chain: entry.chain ?? null,
    source: entry.source,
    useCount: entry.useCount,
    ...(options.includeMetadata
      ? {
          firstUsedAt: entry.firstUsedAt,
          lastUsedAt: entry.lastUsedAt,
          updatedAt: entry.updatedAt,
        }
      : {}),
  };
}

function parseOptionalLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw inputError(
      "INPUT_INVALID_VALUE",
      `Invalid --limit value: ${raw}.`,
      "--limit must be a positive integer.",
    );
  }
  return parsed;
}

function resolveStoredRecipientForRemoval(
  addressOrEns: string,
  entries: readonly RecipientHistoryEntry[] = loadRecipientHistoryEntries(),
): RecipientHistoryEntry | null {
  const trimmed = addressOrEns.trim();
  if (trimmed.length === 0) return null;

  const index = Number.parseInt(trimmed, 10);
  if (
    /^\d+$/.test(trimmed) &&
    Number.isInteger(index) &&
    index >= 1 &&
    index <= entries.length
  ) {
    return entries[index - 1] ?? null;
  }

  const normalized = trimmed.toLowerCase();
  return entries.find((entry) =>
    entry.address.toLowerCase() === normalized ||
    entry.ensName?.toLowerCase() === normalized ||
    entry.label?.toLowerCase() === normalized
  ) ?? null;
}

function renderRecipientList(
  entries: readonly RecipientHistoryEntry[],
  cmd: Command,
  opts: RecipientListCommandOptions,
): void {
  const mode = resolveGlobalMode(rootOptionsForCommand(cmd));
  const ctx = createOutputContext(mode);
  const commandPrefix = recipientCommandPrefix(cmd);
  const chain = recipientCommandChain(cmd, opts);
  try {
    if (mode.isJson) {
      const payload = {
        mode: "recipient-history",
        operation: "list",
        chain: chain ?? "all-chains",
        count: entries.length,
        recipients: entries.map((entry) =>
          recipientPayload(entry, { includeMetadata: opts.includeMetadata }),
        ),
      };
      printJsonSuccess(
        entries.length === 0
          ? appendNextActions(payload, [
              createNextAction(
                "recipients add",
                "Add a known recipient before starting a withdrawal to a saved address.",
                "accounts_summary_empty",
                {
                  options: { agent: true },
                  runnable: false,
                  parameters: [
                    { name: "address", type: "address_or_ens", required: true },
                    { name: "label", type: "string", required: false },
                  ],
                },
              ),
            ])
          : payload,
      );
      return;
    }

    if (mode.isCsv) {
      printCsv(
        ["Address", "Label", "ENS", "Chain", "Source", "Use Count", "First Used", "Last Used", "Updated"],
        entries.map((entry) => [
          entry.address,
          entry.label ?? "",
          entry.ensName ?? "",
          entry.chain ?? "",
          entry.source,
          String(entry.useCount),
          entry.firstUsedAt ?? "",
          entry.lastUsedAt ?? "",
          entry.updatedAt,
        ]),
      );
      return;
    }

    if (isSilent(ctx)) return;
    if (entries.length === 0) {
      info("No remembered withdrawal recipients yet.", false);
      info(`Successful withdrawals are added automatically; use '${commandPrefix} add <address>' to add one manually.`, false);
      return;
    }

    process.stderr.write(formatSectionHeading(
      chain ? `Withdrawal recipients (${chain})` : "Withdrawal recipients",
      { divider: true },
    ));
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
  opts: RecipientListCommandOptions,
  cmd: Command,
): Promise<void> {
  const limit = parseOptionalLimit(opts.limit);
  const chain = recipientCommandChain(cmd, opts);
  const entries = loadRecipientHistoryEntries({ chain });
  renderRecipientList(
    limit === undefined ? entries : entries.slice(0, limit),
    cmd,
    opts,
  );
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
      chain: recipientCommandChain(cmd, opts),
      source: "manual",
    });

    if (mode.isJson) {
      printJsonSuccess({
        mode: "recipient-history",
        operation: "add",
        recipient: recipientPayload(entry, { includeMetadata: opts.includeMetadata }),
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
    const chain = recipientCommandChain(cmd, {});
    const entries = loadRecipientHistoryEntries({ chain });
    const stored = resolveStoredRecipientForRemoval(addressOrEns, entries);
    const resolved = stored
      ? { address: stored.address }
      : await resolveSafeRecipientAddressOrEns(addressOrEns, "Recipient");
    const removed = removeRecipientHistoryEntry(resolved.address, { chain });

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
    const chain = recipientCommandChain(cmd, {});
    const removedCount = clearRecipientHistory({ chain });

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
