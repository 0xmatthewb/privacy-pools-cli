import type { Command } from "commander";
import { createOutputContext } from "../output/common.js";
import { renderFlowResult } from "../output/flow.js";
import {
  FlowCancelledError,
  getWorkflowStatus,
  ragequitWorkflow,
  startWorkflow,
  watchWorkflow,
} from "../services/workflow.js";
import type { GlobalOptions } from "../types.js";
import { CLIError, printError } from "../utils/errors.js";
import { info } from "../utils/format.js";
import { resolveGlobalMode } from "../utils/mode.js";

interface FlowStartCommandOptions {
  to?: string;
  watch?: boolean;
  newWallet?: boolean;
  exportNewWallet?: string;
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

function handleFlowCommandError(
  error: unknown,
  options: { json: boolean; silent: boolean },
): void {
  if (error instanceof FlowCancelledError) {
    if (options.json) {
      printError(flowCancelledCliError(), true);
    } else {
      info("Flow cancelled.", options.silent);
    }
    return;
  }

  printError(error, options.json);
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
    if (!opts.to) {
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
      recipient: opts.to,
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
    handleFlowCommandError(error, {
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
    handleFlowCommandError(error, {
      json: mode.isJson,
      silent: mode.isQuiet,
    });
  }
}

export async function handleFlowWatchCommand(
  workflowId: string | undefined,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    const snapshot = await watchWorkflow({
      workflowId,
      globalOpts,
      mode,
      isVerbose,
    });

    renderFlowResult(ctx, {
      action: "watch",
      snapshot,
    });
  } catch (error) {
    handleFlowCommandError(error, {
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
    const snapshot = getWorkflowStatus({ workflowId });
    renderFlowResult(ctx, {
      action: "status",
      snapshot,
    });
  } catch (error) {
    handleFlowCommandError(error, {
      json: mode.isJson,
      silent: mode.isQuiet,
    });
  }
}
