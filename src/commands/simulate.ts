import type { Command } from "commander";
import { handleDepositCommand } from "./deposit.js";
import { handleRagequitCommand } from "./ragequit.js";
import { handleWithdrawCommand } from "./withdraw.js";
import { printJsonSuccess } from "../output/common.js";
import { CLIError, printError } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";

interface SimulateSharedOptions {
  unsigned?: boolean | string;
  dryRun?: boolean;
}

function delegatedRootCommand(cmd: Command): Command {
  return {
    ...cmd,
    parent: cmd.parent?.parent ?? cmd.parent,
  } as Command;
}

function rejectUnsignedPreview(
  opts: SimulateSharedOptions,
): void {
  if (opts.unsigned === undefined || opts.unsigned === false) return;

  throw new CLIError(
    "simulate is preview-only and does not accept --unsigned.",
    "INPUT",
    "Use the original deposit, withdraw, or ragequit command with --unsigned when you need a signer-facing envelope, or use simulate without --unsigned for a pure dry-run.",
    "INPUT_SIMULATE_UNSIGNED_UNSUPPORTED",
  );
}

async function withSimulateErrorBoundary(
  cmd: Command,
  handler: () => Promise<void>,
): Promise<void> {
  const globalOpts = (cmd.parent?.parent?.opts?.() ??
    cmd.parent?.opts?.()) as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    await handler();
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handleSimulateDepositCommand(
  firstArg: string,
  secondArg: string | undefined,
  opts: SimulateSharedOptions & {
    ignoreUniqueAmount?: boolean;
  },
  cmd: Command,
): Promise<void> {
  await withSimulateErrorBoundary(cmd, async () => {
    rejectUnsignedPreview(opts);
    await handleDepositCommand(
      firstArg,
      secondArg,
      {
        ...opts,
        dryRun: true,
        unsigned: undefined,
      },
      delegatedRootCommand(cmd),
    );
  });
}

export async function handleSimulateRootCommand(
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = (cmd.parent?.opts?.() ?? {}) as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  if (mode.isJson) {
    printJsonSuccess({
      mode: "help",
      command: "simulate",
      subcommands: ["deposit", "withdraw", "ragequit"],
      help: cmd.helpInformation().trimEnd(),
    });
    return;
  }

  cmd.help();
}

export async function handleSimulateWithdrawCommand(
  firstArg: string | undefined,
  secondArg: string | undefined,
  opts: SimulateSharedOptions & {
    to?: string;
    poolAccount?: string;
    direct?: boolean;
    confirmDirectWithdraw?: boolean;
    all?: boolean;
    extraGas?: boolean;
  },
  cmd: Command,
): Promise<void> {
  await withSimulateErrorBoundary(cmd, async () => {
    rejectUnsignedPreview(opts);
    await handleWithdrawCommand(
      firstArg,
      secondArg,
      {
        ...opts,
        dryRun: true,
        unsigned: undefined,
      },
      delegatedRootCommand(cmd),
    );
  });
}

export async function handleSimulateRagequitCommand(
  assetArg: string | undefined,
  opts: SimulateSharedOptions & {
    poolAccount?: string;
    confirmRagequit?: boolean;
  },
  cmd: Command,
): Promise<void> {
  await withSimulateErrorBoundary(cmd, async () => {
    rejectUnsignedPreview(opts);
    await handleRagequitCommand(
      assetArg,
      {
        ...opts,
        dryRun: true,
        unsigned: undefined,
      },
      delegatedRootCommand(cmd),
    );
  });
}
