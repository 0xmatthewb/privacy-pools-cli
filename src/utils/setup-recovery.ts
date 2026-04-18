import type { Command } from "commander";
import { loadConfig } from "../services/config.js";
import { handleInitCommand } from "../commands/init.js";
import type { GlobalOptions } from "../types.js";
import { CLIError, classifyError } from "./errors.js";
import { createNextAction } from "../output/common.js";
import { info } from "./format.js";
import { resolveGlobalMode } from "./mode.js";
import {
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "./prompt-cancellation.js";
import { resolveChain } from "./validation.js";

function getRootCommand(cmd: Command): Command {
  let current = cmd;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

function getRootGlobalOptions(cmd: Command): GlobalOptions {
  const root = getRootCommand(cmd);
  return root.opts() as GlobalOptions;
}

export function isMissingWalletSetupError(error: unknown): boolean {
  const classified = classifyError(error);
  return (
    classified.category === "SETUP" &&
    (
      classified.code === "SETUP_RECOVERY_PHRASE_MISSING" ||
      classified.code === "SETUP_SIGNER_KEY_MISSING"
    )
  );
}

export function normalizeInitRequiredInputError(error: unknown): unknown {
  const classified = classifyError(error);
  if (!isMissingWalletSetupError(classified)) {
    return error;
  }

  return new CLIError(
    "CLI wallet setup is incomplete. Run 'privacy-pools init' before using this command.",
    "SETUP",
    "Run 'privacy-pools init' to load or create your account, or use 'privacy-pools init --signer-only' if only the signer key is missing.",
    "INPUT_INIT_REQUIRED",
    false,
    classified.presentation,
    classified.details,
    classified.docsSlug,
    {
      helpTopic: classified.extra.helpTopic ?? "quickstart",
      nextActions: classified.extra.nextActions ?? [
        createNextAction(
          "init",
          "Complete CLI wallet setup before running wallet-dependent commands.",
          "status_not_ready",
          { options: { agent: true } },
        ),
      ],
    },
  );
}

export async function maybeRecoverMissingWalletSetup(
  error: unknown,
  cmd: Command,
): Promise<boolean> {
  if (!isMissingWalletSetupError(error)) {
    return false;
  }

  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  if (mode.skipPrompts || mode.isJson || mode.isQuiet) {
    return false;
  }

  try {
    ensurePromptInteractionAvailable();
  } catch {
    return false;
  }

  const { confirm } = await import("@inquirer/prompts");

  try {
    const shouldRunInit = await confirm({
      message: "Run privacy-pools init now?",
      default: true,
    });

    if (!shouldRunInit) {
      return false;
    }

    const config = loadConfig();
    const defaultChain = resolveChain(
      globalOpts?.chain,
      config.defaultChain,
    ).name;

    await handleInitCommand(
      { defaultChain },
      { parent: getRootCommand(cmd) } as Command,
    );
    return true;
  } catch (promptError) {
    if (isPromptCancellationError(promptError)) {
      info(PROMPT_CANCELLATION_MESSAGE, false);
      process.exitCode = 0;
      return true;
    }

    throw promptError;
  }
}
