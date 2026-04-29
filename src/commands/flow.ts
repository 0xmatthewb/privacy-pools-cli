import type { Command } from "commander";
import { createNextAction, createOutputContext } from "../output/common.js";
import {
  formatFlowRagequitReview,
  renderFlowPhaseChangeEvent,
  renderFlowResult,
  renderFlowStartDryRun,
  type FlowJsonWarning,
} from "../output/flow.js";
import { loadConfig } from "../services/config.js";
import { isPausedFlowPhase as isPausedFlowPhaseValue } from "../services/flow-phase-graph.js";
import { resolvePool } from "../services/pools.js";
import {
  loadKnownRecipientHistory,
  loadRecipientHistoryEntries,
  type RecipientHistoryEntry,
} from "../services/recipient-history.js";
import { getSignerAddress, loadPrivateKey } from "../services/wallet.js";
import {
  applyFlowPrivacyDelayPolicy,
  computeFlowWatchDelayMs,
  FlowBackRequestedError,
  FlowCancelledError,
  FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE,
  type FlowSnapshot,
  formatWorkflowFundingSummary,
  getWorkflowStatus,
  humanPollDelayLabel,
  initialPollDelayMs,
  isTerminalFlowPhase,
  listSavedWorkflowIds,
  nextPollDelayMs,
  ragequitWorkflow,
  resolveFlowPrivacyDelayProfile,
  resolveOptionalFlowPrivacyDelayProfile,
  saveWorkflowSnapshotIfChangedWithLock,
  stepWorkflow,
  startWorkflow,
  validateWorkflowWalletBackupPath,
} from "../services/workflow.js";
import type { GlobalOptions } from "../types.js";
import {
  buildPrivacyNonRoundAmountWarning,
  formatAmountDecimal,
  isRoundAmount,
  suggestRoundAmounts,
} from "../utils/amount-privacy.js";
import { isNativePoolAsset, POA_PORTAL_URL } from "../config/chains.js";
import { CLIError, printError, promptCancelledError } from "../utils/errors.js";
import {
  deriveTokenPrice,
  formatAddress,
  formatRemainingTime,
  info,
  warn,
} from "../utils/format.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { normalizeDryRunMode, type DryRunMode } from "../utils/dry-run-mode.js";
import {
  canPrompt,
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "../utils/prompt-cancellation.js";
import {
  assertSafeRecipientAddress,
  isKnownRecipient,
  newRecipientWarning,
  resolveSafeRecipientAddressOrEns,
} from "../utils/recipient-safety.js";
import { parseAmount, resolveChain, validatePositive } from "../utils/validation.js";
import {
  maybeRenderPreviewScenario,
  PreviewScenarioRenderedError,
} from "../preview/runtime.js";
import {
  CONFIRMATION_TOKENS,
  confirmActionWithSeverity,
  confirmPrompt,
  inputPrompt,
  type PromptInput,
  selectPrompt,
} from "../utils/prompts.js";
import {
  maybeRecoverMissingWalletSetup,
  normalizeInitRequiredInputError,
} from "../utils/setup-recovery.js";
import { maybeLaunchBrowser } from "../utils/web.js";
import { emitStreamJsonEvent } from "../utils/stream-json.js";

interface FlowStartCommandOptions {
  to?: string;
  watch?: boolean;
  privacyDelay?: string;
  newWallet?: boolean;
  exportNewWallet?: string;
  dryRun?: boolean | string;
  streamJson?: boolean;
  allowNonRoundAmounts?: boolean;
}

interface FlowWatchCommandOptions {
  privacyDelay?: string;
  streamJson?: boolean;
}

interface FlowRagequitCommandOptions {
  confirmRagequit?: boolean;
  streamJson?: boolean;
}

interface FlowStepCommandOptions {
  streamJson?: boolean;
}

const MAX_FLOW_RECIPIENT_PROMPT_ATTEMPTS = 5;

export { createFlowCommand } from "../command-shells/flow.js";

export function getFlowBrowserTarget(snapshot: FlowSnapshot): {
  url: string;
  label: string;
} | null {
  if (snapshot.phase === "paused_poa_required") {
    return {
      url: POA_PORTAL_URL,
      label: "PoA portal",
    };
  }
  if (snapshot.ragequitExplorerUrl) {
    return {
      url: snapshot.ragequitExplorerUrl,
      label: "flow ragequit transaction",
    };
  }
  if (snapshot.withdrawExplorerUrl) {
    return {
      url: snapshot.withdrawExplorerUrl,
      label: "flow withdrawal transaction",
    };
  }
  if (snapshot.depositExplorerUrl) {
    return {
      url: snapshot.depositExplorerUrl,
      label: "flow deposit transaction",
    };
  }
  return null;
}

function getRootGlobalOptions(cmd: Command): GlobalOptions {
  const withGlobals = (cmd as Command & {
    optsWithGlobals?: () => Record<string, unknown>;
  }).optsWithGlobals;
  if (typeof withGlobals === "function") {
    return withGlobals.call(cmd) as GlobalOptions;
  }

  return cmd.parent?.parent?.opts() as GlobalOptions;
}

export function flowCancelledCliError(): CLIError {
  return new CLIError(
    "Flow cancelled.",
    "INPUT",
    "Re-run the flow command when you are ready to continue.",
  );
}

export function flowDetachedCliError(): CLIError {
  return new CLIError(
    "Flow watch detached.",
    "INPUT",
    "Re-run 'privacy-pools flow watch' to resume the saved workflow, or use flow status and flow step in agent mode.",
  );
}

export function isPausedFlowPhase(snapshot: FlowSnapshot): boolean {
  return isPausedFlowPhaseValue(snapshot.phase);
}

export function isWatchTerminalSnapshot(snapshot: FlowSnapshot): boolean {
  return isTerminalFlowPhase(snapshot.phase) || isPausedFlowPhase(snapshot);
}

export function throwIfWatchAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new FlowCancelledError("detached");
  }
}

export async function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new FlowCancelledError("detached"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      cleanup();
      reject(new FlowCancelledError("detached"));
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function sleepWithPrivacyDelayCountdown(params: {
  sleepMs: number;
  privacyDelayUntilMs: number;
  silent: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  if (
    params.silent ||
    !process.stderr.isTTY ||
    !Number.isFinite(params.privacyDelayUntilMs) ||
    params.privacyDelayUntilMs <= Date.now()
  ) {
    await sleepWithAbort(params.sleepMs, params.signal);
    return;
  }

  const pollDeadlineMs = Date.now() + params.sleepMs;
  let lastLineLength = 0;
  const render = () => {
    const line =
      `Privacy delay remaining: ${formatRemainingTime(params.privacyDelayUntilMs)}. ` +
      `Next check in ${formatRemainingTime(pollDeadlineMs)}. Press Ctrl-C to detach.`;
    const padding = " ".repeat(Math.max(0, lastLineLength - line.length));
    process.stderr.write(`\r${line}${padding}`);
    lastLineLength = line.length;
  };

  render();
  const interval = setInterval(render, 1000);
  try {
    await sleepWithAbort(params.sleepMs, params.signal);
  } finally {
    clearInterval(interval);
    process.stderr.write("\n");
  }
}

export async function maybeApplyFlowWatchPrivacyDelayOverride(params: {
  workflowId?: string;
  privacyDelayProfile?: string;
  silent: boolean;
}): Promise<FlowSnapshot> {
  const override = resolveOptionalFlowPrivacyDelayProfile(
    params.privacyDelayProfile,
  );
  const currentSnapshot = getWorkflowStatus({ workflowId: params.workflowId });
  if (!override) {
    return currentSnapshot;
  }

  if (
    currentSnapshot.privacyDelayProfile === override &&
    currentSnapshot.privacyDelayConfigured === true
  ) {
    return currentSnapshot;
  }

  const updatedSnapshot = await saveWorkflowSnapshotIfChangedWithLock(
    currentSnapshot,
    applyFlowPrivacyDelayPolicy(currentSnapshot, override, {
      configured: true,
      rescheduleApproved: true,
    }),
  );
  info(
    `Saved privacy-delay policy updated to ${override}.`,
    params.silent,
  );
  return updatedSnapshot;
}

export async function watchFlowWithStatusAndStep(params: {
  workflowId?: string;
  privacyDelayProfile?: string;
  globalOpts?: GlobalOptions;
  mode: ReturnType<typeof resolveGlobalMode>;
  isVerbose: boolean;
  onPhaseChange?: (event: {
    workflowId: string;
    previousPhase: FlowSnapshot["phase"];
    phase: FlowSnapshot["phase"];
    ts: string;
    snapshot: FlowSnapshot;
  }) => void | Promise<void>;
  abortSignal?: AbortSignal;
}): Promise<FlowSnapshot> {
  const silent = params.mode.isQuiet || params.mode.isJson;
  let snapshot = await maybeApplyFlowWatchPrivacyDelayOverride({
    workflowId: params.workflowId,
    privacyDelayProfile: params.privacyDelayProfile,
    silent,
  });
  let delayMs = initialPollDelayMs(snapshot.phase);

  while (true) {
    throwIfWatchAborted(params.abortSignal);
    if (isWatchTerminalSnapshot(snapshot)) {
      return snapshot;
    }

    const previousPhase = snapshot.phase;
    snapshot = await stepWorkflow({
      workflowId: snapshot.workflowId,
      globalOpts: params.globalOpts,
      mode: params.mode,
      isVerbose: params.isVerbose,
    });

    if (snapshot.phase !== previousPhase) {
      await params.onPhaseChange?.({
        workflowId: snapshot.workflowId,
        previousPhase,
        phase: snapshot.phase,
        ts: new Date().toISOString(),
        snapshot,
      });
      delayMs = initialPollDelayMs(snapshot.phase);
    } else {
      delayMs = nextPollDelayMs(delayMs, snapshot.phase);
    }

    if (isWatchTerminalSnapshot(snapshot)) {
      return snapshot;
    }

    const sleepMs = computeFlowWatchDelayMs(snapshot, delayMs);
    if (snapshot.phase === "awaiting_funding" && snapshot.walletAddress) {
      const fundingSummary = formatWorkflowFundingSummary(snapshot);
      info(
        fundingSummary
          ? `Still waiting for funding at ${snapshot.walletAddress}. Need ${fundingSummary}. Checking again in ${humanPollDelayLabel(sleepMs)}.`
          : `Still waiting for funding at ${snapshot.walletAddress}. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
        silent,
      );
    } else if (snapshot.phase === "depositing_publicly") {
      info(
        `Still reconciling the public deposit step. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
        silent,
      );
    } else if (snapshot.phase === "approved_waiting_privacy_delay") {
      const privacyDelayUntilMs = snapshot.privacyDelayUntil
        ? Date.parse(snapshot.privacyDelayUntil)
        : Number.NaN;
      const privacyDelayRemaining = Number.isFinite(privacyDelayUntilMs)
        ? formatRemainingTime(privacyDelayUntilMs)
        : null;
      info(
        `Still waiting for the saved privacy delay before the private withdrawal.${privacyDelayRemaining ? ` ${privacyDelayRemaining} remaining.` : ""} Checking again in ${humanPollDelayLabel(sleepMs)}.`,
        silent,
      );
      await sleepWithPrivacyDelayCountdown({
        sleepMs,
        privacyDelayUntilMs,
        silent,
        signal: params.abortSignal,
      });
      continue;
    } else if (snapshot.phase === "withdrawing") {
      info(
        `Still waiting for the private withdrawal to settle. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
        silent,
      );
    } else {
      info(
        `Still waiting for saved workflow progress on ${snapshot.chain}. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
        silent,
      );
    }

    await sleepWithAbort(sleepMs, params.abortSignal);
  }
}

export function collectKnownFlowRecipients(chain?: string | null): string[] {
  const recipients: string[] = [...loadKnownRecipientHistory(chain)];
  try {
    recipients.push(getSignerAddress(loadPrivateKey()));
  } catch {
    // A configured signer is not required for --new-wallet or dry-run flows.
  }

  for (const workflowId of listSavedWorkflowIds()) {
    try {
      const snapshot = getWorkflowStatus({ workflowId });
      if (snapshot.recipient) {
        recipients.push(snapshot.recipient);
      }
      if (snapshot.walletAddress) {
        recipients.push(snapshot.walletAddress);
      }
    } catch {
      // Ignore unreadable workflow files here. The actual flow status command
      // still reports them strictly when the user asks for workflow state.
    }
  }
  return recipients;
}

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

function recentRecipientDescription(entry: RecipientHistoryEntry): string {
  return [
    entry.ensName,
    entry.chain,
    entry.useCount > 0 ? `${entry.useCount} use${entry.useCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" - ");
}

async function promptRecentFlowRecipient(): Promise<string | null> {
  const entries = loadRecipientHistoryEntries().slice(0, 5);
  if (entries.length === 0) return null;

  const newRecipientValue = "__privacy_pools_new_recipient__";
  const selected = await selectPrompt<string>({
    message: "Recipient:",
    choices: [
      ...entries.map((entry) => ({
        name: entry.label
          ? `${entry.label} (${formatAddress(entry.address)})`
          : `Recent ${formatAddress(entry.address)}`,
        value: entry.address,
        description: recentRecipientDescription(entry),
      })),
      {
        name: "Enter a new recipient",
        value: newRecipientValue,
        description: "Type an address or ENS name.",
      },
    ],
  });

  return selected === newRecipientValue ? null : selected;
}

export async function promptFlowRecipientAddressOrEns(
  promptInput: PromptInput,
  silent: boolean,
): Promise<string> {
  const remembered = await promptRecentFlowRecipient();
  if (remembered) {
    info(`Using remembered recipient ${remembered}`, silent);
    return remembered;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_FLOW_RECIPIENT_PROMPT_ATTEMPTS; attempt += 1) {
    const prompted = (await promptInput({
      message: "Recipient address or ENS:",
      validate: validateRecipientAddressOrEnsInput,
    })).trim();
    try {
      const resolved = await resolveSafeRecipientAddressOrEns(
        prompted,
        "Recipient",
      );
      if (resolved.ensName) {
        info(`Resolved ${resolved.ensName} -> ${resolved.address}`, silent);
      }
      return resolved.address;
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_FLOW_RECIPIENT_PROMPT_ATTEMPTS) {
        break;
      }
      warn(error instanceof Error ? error.message : "Invalid address or ENS name.", silent);
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new CLIError(
    "Invalid address or ENS name.",
    "INPUT",
    "Re-run with --to <address-or-ens> to skip the interactive recipient prompt.",
    "INPUT_FLOW_RECIPIENT_RETRY_LIMIT",
  );
}

export async function confirmRecipientIfNew(params: {
  address: string;
  knownRecipients: readonly string[];
  skipPrompts: boolean;
  silent: boolean;
}): Promise<FlowJsonWarning[]> {
  if (isKnownRecipient(params.address, params.knownRecipients)) {
    return [];
  }

  const warning = newRecipientWarning(params.address);
  if (params.skipPrompts) {
    return [warning];
  }

  ensurePromptInteractionAvailable();
  warn(warning.message, params.silent);
  const ok = await confirmActionWithSeverity({
    severity: "standard",
    standardMessage: "Use this new recipient?",
    highStakesToken: CONFIRMATION_TOKENS.recipient,
    highStakesWarning: "Recipient review changed while waiting for confirmation.",
    confirm: confirmPrompt,
  });
  if (!ok) {
    throw new FlowCancelledError();
  }
  return [];
}

async function renderFlowStartDryRunForInputs(params: {
  amount: string;
  asset: string;
  recipient: string;
  opts: FlowStartCommandOptions;
  globalOpts: GlobalOptions;
  mode: ReturnType<typeof resolveGlobalMode>;
  ctx: ReturnType<typeof createOutputContext>;
  recipientWarnings: FlowJsonWarning[];
  dryRunMode: DryRunMode;
}): Promise<void> {
  const config = loadConfig();
  const chainConfig = resolveChain(params.globalOpts?.chain, config.defaultChain);
  const pool = await resolvePool(
    chainConfig,
    params.asset,
    params.globalOpts?.rpcUrl,
  );
  const amount = parseAmount(params.amount, pool.decimals, {
    allowNegative: true,
  });
  validatePositive(amount, "Deposit amount");

  if (amount < pool.minimumDepositAmount) {
    throw new CLIError(
      `Deposit amount is below the minimum of ${formatAmountDecimal(pool.minimumDepositAmount, pool.decimals)} ${pool.symbol} for this pool.`,
      "INPUT",
      `Increase the amount to at least ${formatAmountDecimal(pool.minimumDepositAmount, pool.decimals)} ${pool.symbol}.`,
    );
  }

  const warnings: FlowJsonWarning[] = [...params.recipientWarnings];
  let dryRunAmountPatternWarning: string | null = null;
  if (!isRoundAmount(amount, pool.decimals, pool.symbol)) {
    const humanAmount = formatAmountDecimal(amount, pool.decimals);
    const suggestions = suggestRoundAmounts(amount, pool.decimals, pool.symbol);
    const suggestionText =
      suggestions.length > 0
        ? ` Consider: ${suggestions.map((value) => `${formatAmountDecimal(value, pool.decimals)} ${pool.symbol}`).join(", ")}.`
        : "";
    const message =
      `Non-round amount ${humanAmount} ${pool.symbol} may reduce privacy. ` +
      `That pattern can make later withdrawals more identifiable even though the protocol breaks the direct onchain link.${suggestionText}`;
    dryRunAmountPatternWarning = message;
    const warning = buildPrivacyNonRoundAmountWarning({
      amount,
      decimals: pool.decimals,
      symbol: pool.symbol,
      escape: true,
    });
    if (warning) warnings.push(warning);
  }

  const privacyDelayProfile = resolveFlowPrivacyDelayProfile(
    params.opts.privacyDelay,
    "balanced",
  );
  if (privacyDelayProfile === "off") {
    warnings.push({
      code: "timing_delay_disabled",
      category: "privacy",
      message: FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE,
    });
  }

  const vettingFee = (amount * pool.vettingFeeBPS) / 10000n;
  const estimatedCommittedValue = amount - vettingFee;

  renderFlowStartDryRun(params.ctx, {
    chain: chainConfig.name,
    asset: pool.symbol,
    assetDecimals: pool.decimals,
    depositAmount: amount,
    recipient: params.recipient,
    walletMode: params.opts.newWallet ? "new_wallet" : "configured",
    privacyDelayProfile,
    vettingFee,
    estimatedCommittedValue,
    isErc20: !isNativePoolAsset(chainConfig.id, pool.asset),
    tokenPrice: deriveTokenPrice(pool),
    dryRunMode: params.dryRunMode,
    amountPatternWarning: dryRunAmountPatternWarning,
    warnings,
  });
}

async function handleFlowCommandError(
  error: unknown,
  options: {
    cmd: Command;
    json: boolean;
    silent: boolean;
    allowSetupRecovery?: boolean;
    recoveryDetails?: Record<string, unknown>;
  },
): Promise<void> {
  if (error instanceof PreviewScenarioRenderedError) {
    return;
  }

  if (isPromptCancellationError(error)) {
    if (options.json) {
      printError(promptCancelledError(), true);
    } else {
      info(PROMPT_CANCELLATION_MESSAGE, options.silent);
      process.exitCode = 0;
    }
    return;
  }

  if (error instanceof FlowCancelledError) {
    const detached = error.reason === "detached";
    if (options.json) {
      printError(detached ? flowDetachedCliError() : flowCancelledCliError(), true);
    } else {
      info(
        detached
          ? "Detached from flow watch. The saved workflow is unchanged. Re-run 'privacy-pools flow watch' to resume."
          : "Flow cancelled.",
        options.silent,
      );
    }
    return;
  }

  if (
    options.allowSetupRecovery !== false &&
    await maybeRecoverMissingWalletSetup(error, options.cmd)
  ) {
    return;
  }

  printError(
    normalizeInitRequiredInputError(error, options.recoveryDetails),
    options.json,
  );
}

export async function handleFlowRootCommand(
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);

  try {
    if (mode.isJson || !canPrompt()) {
      throw new CLIError(
        "Use a flow subcommand: start, watch, status, step, or ragequit.",
        "INPUT",
        "Run 'privacy-pools flow start', 'privacy-pools flow watch', 'privacy-pools flow status', 'privacy-pools flow step', or 'privacy-pools flow ragequit'.",
        "INPUT_MISSING_FLOW_SUBCOMMAND",
      );
    }

    ensurePromptInteractionAvailable();
    const savedWorkflowIds = await Promise.resolve(listSavedWorkflowIds());
    const latestWorkflowId = savedWorkflowIds[0];
    const hasMultipleSavedWorkflows = savedWorkflowIds.length > 1;
    const workflowChoiceSuffix = latestWorkflowId
      ? ` (${latestWorkflowId})`
      : "";
    const action = await selectPrompt<"start" | "watch" | "status" | "step" | "ragequit" | "choose_saved">({
      message: "What would you like to do?",
      choices: [
        {
          name: "Start a new easy-path flow",
          value: "start",
          description: "Deposit now, then resume later with flow watch.",
        },
        ...(latestWorkflowId
          ? [
              {
                name: `Watch the latest saved flow${workflowChoiceSuffix}`,
                value: "watch",
                description:
                  "Resume the current flow through review, delay, and withdrawal.",
              },
              {
                name: `Check status for the latest saved flow${workflowChoiceSuffix}`,
                value: "status",
                description: "Show the saved flow snapshot without advancing it.",
              },
              {
                name: `Step the latest saved flow${workflowChoiceSuffix}`,
                value: "step",
                description: "Advance the saved flow by one unit of work.",
              },
              {
                name: `Ragequit the latest saved flow${workflowChoiceSuffix}`,
                value: "ragequit",
                description:
                  "Use the public recovery path for the latest saved flow.",
              },
              ...(hasMultipleSavedWorkflows
                ? [
                    {
                      name: "Choose another saved flow",
                      value: "choose_saved",
                      description:
                        "Pick a specific saved flow, then watch, inspect, or ragequit it.",
                    },
                  ]
                : []),
            ]
          : []),
      ],
    });

    if (action === "start") {
      const amount = (await inputPrompt({
        message: "Deposit amount:",
        default: "0.1",
      })).trim();
      const asset = (await inputPrompt({
        message: "Asset symbol:",
        default: "ETH",
      })).trim().toUpperCase();
      const recipient = await promptFlowRecipientAddressOrEns(
        inputPrompt,
        mode.isQuiet || mode.isJson,
      );
      await handleFlowStartCommand(amount, asset, { to: recipient }, cmd);
      return;
    }

    if (action === "watch") {
      await handleFlowWatchCommand("latest", {}, cmd);
      return;
    }

    if (action === "status") {
      await handleFlowStatusCommand("latest", {}, cmd);
      return;
    }

    if (action === "step") {
      await handleFlowStepCommand("latest", {}, cmd);
      return;
    }

    if (action === "ragequit") {
      await handleFlowRagequitCommand("latest", {}, cmd);
      return;
    }

    if (action === "choose_saved") {
      const selectedWorkflowId = await selectPrompt<string>({
        message: "Choose a saved flow:",
        choices: savedWorkflowIds.map((workflowId) => ({
          name: workflowId,
          value: workflowId,
        })),
      });
      const savedWorkflowAction = await selectPrompt<"watch" | "status" | "step" | "ragequit">({
        message: `What would you like to do with ${selectedWorkflowId}?`,
        choices: [
          {
            name: "Watch this saved flow",
            value: "watch",
            description:
              "Resume the selected flow through review, delay, and withdrawal.",
          },
          {
            name: "Check saved flow status",
            value: "status",
            description: "Show the saved flow snapshot without advancing it.",
          },
          {
            name: "Step this saved flow",
            value: "step",
            description: "Advance the selected flow by one unit of work.",
          },
          {
            name: "Ragequit this saved flow",
            value: "ragequit",
            description: "Use the public recovery path for the selected flow.",
          },
        ],
      });

      if (savedWorkflowAction === "watch") {
        await handleFlowWatchCommand(selectedWorkflowId, {}, cmd);
        return;
      }

      if (savedWorkflowAction === "status") {
        await handleFlowStatusCommand(selectedWorkflowId, {}, cmd);
        return;
      }

      if (savedWorkflowAction === "step") {
        await handleFlowStepCommand(selectedWorkflowId, {}, cmd);
        return;
      }

      await handleFlowRagequitCommand(selectedWorkflowId, {}, cmd);
      return;
    }
  } catch (error) {
    await handleFlowCommandError(error, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
    });
  }
}

export async function handleFlowStartCommand(
  amount: string,
  asset: string,
  opts: FlowStartCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const streamJson = opts.streamJson === true;
  const mode = resolveGlobalMode({
    ...globalOpts,
    ...(streamJson ? { json: true } : {}),
  });
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);
  let errorRecoveryContext: Record<string, unknown> = {};

  try {
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "start",
      event: "stage",
      stage: "validating_input",
    });
    if (await maybeRenderPreviewScenario("flow start")) {
      return;
    }

    if (mode.isAgent && opts.watch) {
      throw new CLIError(
        "flow start --watch is not available in --agent mode.",
        "INPUT",
        "Run 'privacy-pools flow start ... --agent' without --watch, then use 'privacy-pools flow status <workflowId> --agent' and 'privacy-pools flow step <workflowId> --agent' externally.",
        "INPUT_AGENT_FLOW_WATCH_UNSUPPORTED",
        false,
        undefined,
        undefined,
        undefined,
        {
          nextActions: [
            createNextAction(
              "flow status",
              "Poll the saved workflow state without running an internal watch loop.",
              "flow_resume",
              {
                options: { agent: true },
                parameters: [
                  { name: "workflowId", type: "workflow_id", required: true },
                ],
                runnable: false,
              },
            ),
            createNextAction(
              "flow step",
              "Advance the saved workflow with one unit of work at a time.",
              "flow_resume",
              {
                options: { agent: true },
                parameters: [
                  { name: "workflowId", type: "workflow_id", required: true },
                ],
                runnable: false,
              },
            ),
          ],
        },
      );
    }

    let recipient = opts.to?.trim();
    if (!recipient && !mode.skipPrompts) {
      ensurePromptInteractionAvailable();
      recipient = await promptFlowRecipientAddressOrEns(
        inputPrompt,
        mode.isQuiet || mode.isJson,
      );
    }

    if (
      await maybeRenderPreviewScenario("flow start", {
        timing: "after-prompts",
      })
    ) {
      return;
    }

    if (!recipient) {
      throw new CLIError(
        "Missing required --to <address> in non-interactive mode.",
        "INPUT",
        "Use 'privacy-pools flow start <amount> <asset> --to 0xRecipient...' or re-run interactively to be prompted.",
        "INPUT_MISSING_RECIPIENT",
        false,
        undefined,
        undefined,
        undefined,
        {
          nextActions: [
            createNextAction(
              "flow start",
              "Provide the withdrawal recipient address before creating the saved flow.",
              "flow_manual_followup",
              {
                args: [amount, asset],
                options: { agent: true },
                runnable: false,
                parameters: [{ name: "to", type: "address", required: true }],
              },
            ),
          ],
        },
      );
    }

    if (!opts.newWallet && opts.exportNewWallet?.trim()) {
      throw new CLIError(
        "--export-new-wallet requires --new-wallet.",
        "INPUT",
        "Re-run with --new-wallet to generate a dedicated workflow wallet, or remove --export-new-wallet.",
      );
    }

    const dryRunMode: DryRunMode | null = normalizeDryRunMode(opts.dryRun);
    const isDryRun = dryRunMode !== null;

    if (isDryRun && opts.newWallet && mode.skipPrompts && !opts.exportNewWallet?.trim()) {
      throw new CLIError(
        "Non-interactive workflow wallets require --export-new-wallet <path>.",
        "INPUT",
        "Re-run with --export-new-wallet <path> so the new wallet key is backed up before the flow starts.",
      );
    }

    if (isDryRun && opts.newWallet && opts.exportNewWallet?.trim()) {
      validateWorkflowWalletBackupPath(opts.exportNewWallet);
    }

    const resolvedRecipient = await resolveSafeRecipientAddressOrEns(
      recipient,
      "Recipient",
    );
    if (resolvedRecipient.ensName) {
      info(`Resolved ${resolvedRecipient.ensName} -> ${resolvedRecipient.address}`, mode.isQuiet || mode.isJson);
    }
    recipient = resolvedRecipient.address;
    const recipientChain = globalOpts.chain ?? loadConfig().defaultChain;
    errorRecoveryContext = { chain: recipientChain };

    const recipientWarnings = await confirmRecipientIfNew({
      address: recipient,
      knownRecipients: collectKnownFlowRecipients(recipientChain),
      skipPrompts: mode.skipPrompts || isDryRun,
      silent: mode.isQuiet || mode.isJson,
    });

    if (isDryRun) {
      emitStreamJsonEvent(streamJson, {
        mode: "flow-progress",
        action: "start",
        event: "stage",
        stage: "building_dry_run",
      });
      await renderFlowStartDryRunForInputs({
        amount,
        asset,
        recipient,
        opts,
        globalOpts,
        mode,
        ctx,
        recipientWarnings,
        dryRunMode,
      });
      return;
    }

    const watchRequested = opts.watch ?? false;
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "start",
      event: "stage",
      stage: "starting_workflow",
      asset,
    });
    let snapshot = await startWorkflow({
      amountInput: amount,
      assetInput: asset,
      recipient,
      privacyDelayProfile: opts.privacyDelay,
      newWallet: opts.newWallet ?? false,
      exportNewWallet: opts.exportNewWallet,
      allowNonRoundAmounts: opts.allowNonRoundAmounts ?? false,
      globalOpts,
      mode,
      isVerbose,
      watch: false,
    });

    if (watchRequested) {
      emitStreamJsonEvent(streamJson, {
        mode: "flow-progress",
        action: "start",
        event: "stage",
        stage: "watching_workflow",
        workflowId: snapshot.workflowId,
        phase: snapshot.phase,
      });
      snapshot = await watchFlowWithStatusAndStep({
        workflowId: snapshot.workflowId,
        privacyDelayProfile: opts.privacyDelay,
        globalOpts,
        mode,
        isVerbose,
      });
    }
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: watchRequested ? "watch" : "start",
      event: "stage",
      stage: "complete",
      workflowId: snapshot.workflowId,
      phase: snapshot.phase,
    });

    renderFlowResult(ctx, {
      action: watchRequested ? "watch" : "start",
      snapshot,
      extraWarnings: recipientWarnings,
    });
    const browserTarget = getFlowBrowserTarget(snapshot);
    if (browserTarget) {
      maybeLaunchBrowser({
        globalOpts,
        mode,
        url: browserTarget.url,
        label: browserTarget.label,
        silent: mode.isQuiet,
      });
    }
  } catch (error) {
    if (error instanceof FlowBackRequestedError && !mode.skipPrompts) {
      ensurePromptInteractionAvailable();
      const amendedAmount = await inputPrompt({
        message: "Back: deposit amount:",
        default: amount,
        validate: (value) =>
          value.trim().length > 0 ? true : "Enter a deposit amount.",
      });
      const amendedRecipient = await promptFlowRecipientAddressOrEns(
        inputPrompt,
        mode.isQuiet || mode.isJson,
      );
      await handleFlowStartCommand(
        amendedAmount.trim(),
        asset,
        { ...opts, to: amendedRecipient },
        cmd,
      );
      return;
    }
    const actionableError =
      error instanceof CLIError &&
      (error.code === "INPUT_BAD_ADDRESS" || error.code === "INPUT_NONROUND_AMOUNT") &&
      !error.extra.nextActions
        ? new CLIError(
            error.message,
            error.category,
            error.hint,
            error.code,
            error.retryable,
            error.presentation,
            error.details,
            error.docsSlug,
            {
              ...error.extra,
              nextActions: [
                createNextAction(
                  "flow start",
                  "Correct the flow start inputs and retry.",
                  "flow_manual_followup",
                  {
                    args: [amount, asset],
                    options: { agent: true },
                    runnable: false,
                    parameters: error.code === "INPUT_BAD_ADDRESS"
                      ? [{ name: "to", type: "address", required: true }]
                      : [{ name: "amount", type: "round_token_amount", required: true }],
                  },
                ),
              ],
            },
          )
        : error;
    await handleFlowCommandError(actionableError, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
      recoveryDetails: errorRecoveryContext,
    });
  }
}

export async function handleFlowRagequitCommand(
  workflowId: string | undefined,
  opts: FlowRagequitCommandOptions = {},
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const streamJson = opts.streamJson === true;
  const mode = resolveGlobalMode({
    ...globalOpts,
    ...(streamJson ? { json: true } : {}),
  });
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "ragequit",
      event: "stage",
      stage: "loading_workflow",
      workflowId: workflowId ?? "latest",
    });
    if (await maybeRenderPreviewScenario("flow ragequit")) {
      return;
    }

    const snapshot = getWorkflowStatus({ workflowId });
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "ragequit",
      event: "stage",
      stage: "workflow_loaded",
      workflowId: snapshot.workflowId,
      phase: snapshot.phase,
    });

    if (!mode.skipPrompts) {
      process.stderr.write("\n");
      process.stderr.write(formatFlowRagequitReview(snapshot));
      if (
        await maybeRenderPreviewScenario("flow ragequit", {
          timing: "after-prompts",
        })
      ) {
        return;
      }
      const ok = await confirmActionWithSeverity({
        severity: "high_stakes",
        standardMessage: "Confirm ragequit?",
        highStakesToken: CONFIRMATION_TOKENS.ragequit,
        highStakesWarning:
          "This saved flow will ragequit funds back to the original deposit address. It does not preserve privacy.",
        confirm: confirmPrompt,
      });
      if (!ok) {
        throw new FlowCancelledError();
      }
    } else if (
      snapshot.aspStatus === "approved"
      && opts.confirmRagequit !== true
    ) {
      throw new CLIError(
        `${snapshot.poolAccountId ?? "This workflow"} is approved for private withdrawal.`,
        "INPUT",
        "Ragequit returns the full Pool Account balance to the original deposit address and publicly links your deposit to its withdrawal. Use flow status and flow step unless you intentionally prefer public recovery.",
        "INPUT_APPROVED_WORKFLOW_RAGEQUIT_REQUIRES_OVERRIDE",
        false,
        undefined,
        {
          workflowId: snapshot.workflowId,
          poolAccountId: snapshot.poolAccountId ?? null,
        },
        undefined,
        {
          helpTopic: "ragequit",
          nextActions: [
            createNextAction(
              "flow status",
              "Inspect the saved workflow on the private path before choosing public recovery.",
              "flow_resume",
              {
                args: [snapshot.workflowId],
                options: { agent: true },
              },
            ),
            createNextAction(
              "flow step",
              "Advance the saved workflow on the private path instead of choosing public recovery.",
              "flow_resume",
              {
                args: [snapshot.workflowId],
                options: { agent: true },
              },
            ),
            createNextAction(
              "flow ragequit",
              "Retry only if you intentionally prefer the public recovery path.",
              "after_dry_run",
              {
                args: [snapshot.workflowId],
                options: { agent: true, confirmRagequit: true },
              },
            ),
          ],
        },
      );
    }

    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "ragequit",
      event: "stage",
      stage: "submitting_ragequit",
      workflowId: snapshot.workflowId,
      phase: snapshot.phase,
    });

    const resultSnapshot = await ragequitWorkflow({
      workflowId,
      globalOpts,
      mode,
      isVerbose,
    });
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "ragequit",
      event: "stage",
      stage: "complete",
      workflowId: resultSnapshot.workflowId,
      phase: resultSnapshot.phase,
    });

    renderFlowResult(ctx, {
      action: "ragequit",
      snapshot: resultSnapshot,
    });
    const browserTarget = getFlowBrowserTarget(resultSnapshot);
    if (browserTarget) {
      maybeLaunchBrowser({
        globalOpts,
        mode,
        url: browserTarget.url,
        label: browserTarget.label,
        silent: mode.isQuiet,
      });
    }
  } catch (error) {
    await handleFlowCommandError(error, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
    });
  }
}

export async function handleFlowWatchCommand(
  workflowId: string | undefined,
  opts: FlowWatchCommandOptions = {},
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode({
    ...globalOpts,
    ...(opts.streamJson ? { json: true } : {}),
  });
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);
  const detachController = !mode.isJson ? new AbortController() : null;
  const onSigInt = () => {
    detachController?.abort();
  };

  try {
    if (await maybeRenderPreviewScenario("flow watch")) {
      return;
    }

    if (mode.isAgent) {
      throw new CLIError(
        "flow watch is not available in --agent mode.",
        "INPUT",
        "Use 'privacy-pools flow status <workflowId> --agent' to poll and 'privacy-pools flow step <workflowId> --agent' to advance the workflow one step at a time.",
        "INPUT_AGENT_FLOW_WATCH_UNSUPPORTED",
        false,
        undefined,
        undefined,
        undefined,
        {
          nextActions: [
            createNextAction(
              "flow status",
              "Poll the saved workflow state without running an internal watch loop.",
              "flow_resume",
              {
                options: { agent: true },
                parameters: [
                  { name: "workflowId", type: "workflow_id", required: true },
                ],
                runnable: false,
              },
            ),
            createNextAction(
              "flow step",
              "Advance the saved workflow with one unit of work at a time.",
              "flow_resume",
              {
                options: { agent: true },
                parameters: [
                  { name: "workflowId", type: "workflow_id", required: true },
                ],
                runnable: false,
              },
            ),
          ],
        },
      );
    }

    if (detachController) {
      process.once("SIGINT", onSigInt);
    }

    const snapshot = await watchFlowWithStatusAndStep({
      workflowId,
      privacyDelayProfile: opts.privacyDelay,
      globalOpts,
      mode,
      isVerbose,
      abortSignal: detachController?.signal,
      onPhaseChange: mode.isJson
        ? (event) => {
            renderFlowPhaseChangeEvent(event);
          }
        : undefined,
    });

    renderFlowResult(ctx, {
      action: "watch",
      snapshot,
    });
    const browserTarget = getFlowBrowserTarget(snapshot);
    if (browserTarget) {
      maybeLaunchBrowser({
        globalOpts,
        mode,
        url: browserTarget.url,
        label: browserTarget.label,
        silent: mode.isQuiet,
      });
    }
  } catch (error) {
    if (
      error instanceof CLIError &&
      error.code === "FLOW_RELAYER_MINIMUM_BLOCKED"
    ) {
      try {
        const snapshot = getWorkflowStatus({ workflowId });
        renderFlowResult(ctx, {
          action: "watch",
          snapshot,
        });
        const browserTarget = getFlowBrowserTarget(snapshot);
        if (browserTarget) {
          maybeLaunchBrowser({
            globalOpts,
            mode,
            url: browserTarget.url,
            label: browserTarget.label,
            silent: mode.isQuiet,
          });
        }
        return;
      } catch {
        // Fall through to the original error if the saved workflow itself
        // cannot be reloaded cleanly.
      }
    }
    await handleFlowCommandError(error, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
    });
  } finally {
    if (detachController) {
      process.off("SIGINT", onSigInt);
    }
  }
}

export async function handleFlowStatusCommand(
  workflowId: string | undefined,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    if (await maybeRenderPreviewScenario("flow status")) {
      return;
    }

    const snapshot = getWorkflowStatus({ workflowId });
    renderFlowResult(ctx, {
      action: "status",
      snapshot,
    });
    const browserTarget = getFlowBrowserTarget(snapshot);
    if (browserTarget) {
      maybeLaunchBrowser({
        globalOpts,
        mode,
        url: browserTarget.url,
        label: browserTarget.label,
        silent: mode.isQuiet,
      });
    }
  } catch (error) {
    await handleFlowCommandError(error, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
      allowSetupRecovery: false,
    });
  }
}

export async function handleFlowStepCommand(
  workflowId: string | undefined,
  opts: FlowStepCommandOptions = {},
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const streamJson = opts.streamJson === true;
  const mode = resolveGlobalMode({
    ...globalOpts,
    ...(streamJson ? { json: true } : {}),
  });
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "step",
      event: "stage",
      stage: "stepping_workflow",
      workflowId: workflowId ?? "latest",
    });
    if (await maybeRenderPreviewScenario("flow step")) {
      return;
    }

    const snapshot = await stepWorkflow({
      workflowId,
      globalOpts,
      mode,
      isVerbose,
    });
    emitStreamJsonEvent(streamJson, {
      mode: "flow-progress",
      action: "step",
      event: "stage",
      stage: "complete",
      workflowId: snapshot.workflowId,
      phase: snapshot.phase,
    });
    renderFlowResult(ctx, {
      action: "step",
      snapshot,
    });
    const browserTarget = getFlowBrowserTarget(snapshot);
    if (browserTarget) {
      maybeLaunchBrowser({
        globalOpts,
        mode,
        url: browserTarget.url,
        label: browserTarget.label,
        silent: mode.isQuiet,
      });
    }
  } catch (error) {
    await handleFlowCommandError(error, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
      allowSetupRecovery: false,
    });
  }
}
