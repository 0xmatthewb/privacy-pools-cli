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
import { resolvePool } from "../services/pools.js";
import { loadKnownRecipientHistory } from "../services/recipient-history.js";
import { getSignerAddress, loadPrivateKey } from "../services/wallet.js";
import {
  applyFlowPrivacyDelayPolicy,
  buildAmountPatternLinkabilityWarning,
  computeFlowWatchDelayMs,
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
import { formatAmountDecimal, isRoundAmount, suggestRoundAmounts } from "../utils/amount-privacy.js";
import { isNativePoolAsset, POA_PORTAL_URL } from "../config/chains.js";
import { CLIError, printError, promptCancelledError } from "../utils/errors.js";
import { deriveTokenPrice, info, warn } from "../utils/format.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
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
import { confirmActionWithSeverity } from "../utils/prompts.js";
import { CONFIRMATION_TOKENS } from "../utils/prompts.js";
import {
  maybeRecoverMissingWalletSetup,
  normalizeInitRequiredInputError,
} from "../utils/setup-recovery.js";
import { maybeLaunchBrowser } from "../utils/web.js";

interface FlowStartCommandOptions {
  to?: string;
  watch?: boolean;
  privacyDelay?: string;
  newWallet?: boolean;
  exportNewWallet?: string;
  dryRun?: boolean;
}

interface FlowWatchCommandOptions {
  privacyDelay?: string;
  streamJson?: boolean;
}

interface FlowRagequitCommandOptions {
  confirmRagequit?: boolean;
}

export { createFlowCommand } from "../command-shells/flow.js";

function getFlowBrowserTarget(snapshot: FlowSnapshot): {
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

function flowCancelledCliError(): CLIError {
  return new CLIError(
    "Flow cancelled.",
    "INPUT",
    "Re-run the flow command when you are ready to continue.",
  );
}

function flowDetachedCliError(): CLIError {
  return new CLIError(
    "Flow watch detached.",
    "INPUT",
    "Re-run 'privacy-pools flow watch' to resume the saved workflow, or use flow status and flow step in agent mode.",
  );
}

function isPausedFlowPhase(snapshot: FlowSnapshot): boolean {
  return (
    snapshot.phase === "paused_declined" ||
    snapshot.phase === "paused_poa_required"
  );
}

function isWatchTerminalSnapshot(snapshot: FlowSnapshot): boolean {
  return isTerminalFlowPhase(snapshot.phase) || isPausedFlowPhase(snapshot);
}

function throwIfWatchAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new FlowCancelledError("detached");
  }
}

async function sleepWithAbort(
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

async function maybeApplyFlowWatchPrivacyDelayOverride(params: {
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

async function watchFlowWithStatusAndStep(params: {
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
      info(
        `Still waiting for the saved privacy delay before the private withdrawal. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
        silent,
      );
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

function collectKnownFlowRecipients(): string[] {
  const recipients: string[] = [...loadKnownRecipientHistory()];
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

function validateRecipientAddressOrEnsInput(value: string): true | string {
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

async function promptFlowRecipientAddressOrEns(
  inputPrompt: typeof import("@inquirer/prompts").input,
  silent: boolean,
): Promise<string> {
  while (true) {
    const prompted = (await inputPrompt({
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
      warn(error instanceof Error ? error.message : "Invalid address or ENS name.", silent);
    }
  }
}

async function confirmRecipientIfNew(params: {
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

  warn(warning.message, params.silent);
  const { confirm } = await import("@inquirer/prompts");
  ensurePromptInteractionAvailable();
  const ok = await confirmActionWithSeverity({
    severity: "standard",
    standardMessage: "Use this new recipient?",
    highStakesToken: CONFIRMATION_TOKENS.recipient,
    highStakesWarning: "Recipient review changed while waiting for confirmation.",
    confirm,
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
    if (params.mode.skipPrompts) {
      throw new CLIError(
        message,
        "INPUT",
        suggestionText || "Use a round amount.",
        "INPUT_NONROUND_AMOUNT",
      );
    }
    warnings.push({
      code: "amount_pattern_linkability",
      category: "privacy",
      message,
    });
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
  const amountPatternWarning = buildAmountPatternLinkabilityWarning(
    estimatedCommittedValue,
    pool.decimals,
    pool.symbol,
    { estimated: true },
  );
  if (amountPatternWarning) {
    warnings.push(amountPatternWarning);
  }

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

  printError(normalizeInitRequiredInputError(error), options.json);
}

export async function handleFlowRootCommand(
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);

  try {
    if (mode.isJson || !process.stdin.isTTY || !process.stderr.isTTY) {
      throw new CLIError(
        "Use a flow subcommand in non-interactive mode: start, watch, status, step, or ragequit.",
        "INPUT",
        "Run 'privacy-pools flow start', 'privacy-pools flow watch', 'privacy-pools flow status', 'privacy-pools flow step', or 'privacy-pools flow ragequit'.",
        "INPUT_MISSING_FLOW_SUBCOMMAND",
      );
    }

    ensurePromptInteractionAvailable();
    const [{ input, select }, savedWorkflowIds] = await Promise.all([
      import("@inquirer/prompts"),
      Promise.resolve(listSavedWorkflowIds()),
    ]);
    const latestWorkflowId = savedWorkflowIds[0];
    const hasMultipleSavedWorkflows = savedWorkflowIds.length > 1;
    const workflowChoiceSuffix = latestWorkflowId
      ? ` (${latestWorkflowId})`
      : "";
    const action = await select({
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
      const amount = (await input({
        message: "Deposit amount:",
        default: "0.1",
      })).trim();
      const asset = (await input({
        message: "Asset symbol:",
        default: "ETH",
      })).trim().toUpperCase();
      const recipient = await promptFlowRecipientAddressOrEns(
        input,
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

    if (action === "ragequit") {
      await handleFlowRagequitCommand("latest", {}, cmd);
      return;
    }

    if (action === "choose_saved") {
      const selectedWorkflowId = await select({
        message: "Choose a saved flow:",
        choices: savedWorkflowIds.map((workflowId) => ({
          name: workflowId,
          value: workflowId,
        })),
      });
      const savedWorkflowAction = await select({
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
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
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
      const { input } = await import("@inquirer/prompts");
      ensurePromptInteractionAvailable();
      recipient = await promptFlowRecipientAddressOrEns(
        input,
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
      );
    }

    if (!opts.newWallet && opts.exportNewWallet?.trim()) {
      throw new CLIError(
        "--export-new-wallet requires --new-wallet.",
        "INPUT",
        "Re-run with --new-wallet to generate a dedicated workflow wallet, or remove --export-new-wallet.",
      );
    }

    if (opts.dryRun && opts.newWallet && mode.skipPrompts && !opts.exportNewWallet?.trim()) {
      throw new CLIError(
        "Non-interactive workflow wallets require --export-new-wallet <path>.",
        "INPUT",
        "Re-run with --export-new-wallet <path> so the new wallet key is backed up before the flow starts.",
      );
    }

    if (opts.dryRun && opts.newWallet && opts.exportNewWallet?.trim()) {
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

    const recipientWarnings = await confirmRecipientIfNew({
      address: recipient,
      knownRecipients: collectKnownFlowRecipients(),
      skipPrompts: mode.skipPrompts || Boolean(opts.dryRun),
      silent: mode.isQuiet || mode.isJson,
    });

    if (opts.dryRun) {
      await renderFlowStartDryRunForInputs({
        amount,
        asset,
        recipient,
        opts,
        globalOpts,
        mode,
        ctx,
        recipientWarnings,
      });
      return;
    }

    const watchRequested = opts.watch ?? false;
    let snapshot = await startWorkflow({
      amountInput: amount,
      assetInput: asset,
      recipient,
      privacyDelayProfile: opts.privacyDelay,
      newWallet: opts.newWallet ?? false,
      exportNewWallet: opts.exportNewWallet,
      globalOpts,
      mode,
      isVerbose,
      watch: false,
    });

    if (watchRequested) {
      snapshot = await watchFlowWithStatusAndStep({
        workflowId: snapshot.workflowId,
        privacyDelayProfile: opts.privacyDelay,
        globalOpts,
        mode,
        isVerbose,
      });
    }

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
    await handleFlowCommandError(error, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
    });
  }
}

export async function handleFlowRagequitCommand(
  workflowId: string | undefined,
  opts: FlowRagequitCommandOptions = {},
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    if (await maybeRenderPreviewScenario("flow ragequit")) {
      return;
    }

    const snapshot = getWorkflowStatus({ workflowId });

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
      const { confirm } = await import("@inquirer/prompts");
      const ok = await confirmActionWithSeverity({
        severity: "high_stakes",
        standardMessage: "Confirm ragequit?",
        highStakesToken: CONFIRMATION_TOKENS.ragequit,
        highStakesWarning:
          "This saved flow will ragequit funds back to the original deposit address. It does not preserve privacy.",
        confirm,
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
        "Ragequit publicly recovers all funds to your deposit address. You will not gain any privacy. Use flow status and flow step unless you intentionally prefer ragequit.",
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

    const resultSnapshot = await ragequitWorkflow({
      workflowId,
      globalOpts,
      mode,
      isVerbose,
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
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    if (await maybeRenderPreviewScenario("flow step")) {
      return;
    }

    const snapshot = await stepWorkflow({
      workflowId,
      globalOpts,
      mode,
      isVerbose,
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
