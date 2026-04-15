import type { Command } from "commander";
import { createOutputContext } from "../output/common.js";
import { formatFlowRagequitReview, renderFlowResult } from "../output/flow.js";
import {
  FlowCancelledError,
  getWorkflowStatus,
  listSavedWorkflowIds,
  ragequitWorkflow,
  startWorkflow,
  watchWorkflow,
} from "../services/workflow.js";
import type { GlobalOptions } from "../types.js";
import { CLIError, printError, promptCancelledError } from "../utils/errors.js";
import { info } from "../utils/format.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "../utils/prompt-cancellation.js";
import { validateAddress } from "../utils/validation.js";
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
      cmd.outputHelp();
      return;
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
      const recipient = (await input({
        message: "Recipient address:",
        validate: (value) => {
          try {
            validateAddress(value, "Recipient");
            return true;
          } catch (error) {
            return error instanceof Error ? error.message : "Invalid address.";
          }
        },
      })).trim();
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
      const prompted = await input({
        message: "Recipient address:",
        validate: (value) => {
          try {
            validateAddress(value, "Recipient");
            return true;
          } catch (error) {
            return error instanceof Error ? error.message : "Invalid address.";
          }
        },
      });
      recipient = validateAddress(prompted, "Recipient");
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
