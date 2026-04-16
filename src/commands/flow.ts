import type { Command } from "commander";
import { createOutputContext } from "../output/common.js";
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
  buildAmountPatternLinkabilityWarning,
  FlowCancelledError,
  FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE,
  getWorkflowStatus,
  listSavedWorkflowIds,
  ragequitWorkflow,
  resolveFlowPrivacyDelayProfile,
  startWorkflow,
  validateWorkflowWalletBackupPath,
  watchWorkflow,
} from "../services/workflow.js";
import type { GlobalOptions } from "../types.js";
import { formatAmountDecimal, isRoundAmount, suggestRoundAmounts } from "../utils/amount-privacy.js";
import { isNativePoolAsset } from "../config/chains.js";
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
import { maybeRecoverMissingWalletSetup } from "../utils/setup-recovery.js";

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
}

export { createFlowCommand } from "../command-shells/flow.js";

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
    highStakesToken: "RECIPIENT",
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
      throw new CLIError(message, "INPUT", suggestionText || "Use a round amount.");
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
    if (options.json) {
      printError(flowCancelledCliError(), true);
    } else {
      info("Flow cancelled.", options.silent);
    }
    return;
  }

  if (
    options.allowSetupRecovery !== false &&
    await maybeRecoverMissingWalletSetup(error, options.cmd)
  ) {
    return;
  }

  printError(error, options.json);
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
        "Use a flow subcommand in non-interactive mode: start, watch, status, or ragequit.",
        "INPUT",
        "Run 'privacy-pools flow start', 'privacy-pools flow watch', 'privacy-pools flow status', or 'privacy-pools flow ragequit'.",
        "INPUT_MISSING_FLOW_SUBCOMMAND",
      );
    }

    ensurePromptInteractionAvailable();
    const [{ input, select }, savedWorkflowIds] = await Promise.all([
      import("@inquirer/prompts"),
      Promise.resolve(listSavedWorkflowIds()),
    ]);
    const latestWorkflowId = savedWorkflowIds[0];
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
        "Missing required --to <address>.",
        "INPUT",
        "Use 'privacy-pools flow start <amount> <asset> --to 0xRecipient...'.",
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
      skipPrompts: mode.skipPrompts,
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

    const snapshot = await startWorkflow({
      amountInput: amount,
      assetInput: asset,
      recipient,
      privacyDelayProfile: opts.privacyDelay,
      newWallet: opts.newWallet ?? false,
      exportNewWallet: opts.exportNewWallet,
      globalOpts,
      mode,
      isVerbose,
      watch: opts.watch ?? false,
    });

    renderFlowResult(ctx, {
      action: "start",
      snapshot,
      extraWarnings: recipientWarnings,
    });
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
  _opts: unknown,
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

    if (!mode.skipPrompts) {
      const snapshot = getWorkflowStatus({ workflowId });
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
        highStakesToken: "RAGEQUIT",
        highStakesWarning:
          "This saved flow will ragequit funds back to the original deposit address. Privacy will not be preserved.",
        confirm,
      });
      if (!ok) {
        throw new FlowCancelledError();
      }
    }

    const snapshot = await ragequitWorkflow({
      workflowId,
      globalOpts,
      mode,
      isVerbose,
    });

    renderFlowResult(ctx, {
      action: "ragequit",
      snapshot,
    });
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
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    if (await maybeRenderPreviewScenario("flow watch")) {
      return;
    }

    const snapshot = await watchWorkflow({
      workflowId,
      privacyDelayProfile: opts.privacyDelay,
      globalOpts,
      mode,
      isVerbose,
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
  } catch (error) {
    await handleFlowCommandError(error, {
      cmd,
      json: mode.isJson,
      silent: mode.isQuiet,
      allowSetupRecovery: false,
    });
  }
}
