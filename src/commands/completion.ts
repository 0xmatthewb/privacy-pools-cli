import type { Command } from "commander";
import { CLIError, printError } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  detectCompletionShell,
  isCompletionShell,
  queryCompletionCandidates,
  renderCompletionScript as generateCompletionScript,
  SUPPORTED_COMPLETION_SHELLS,
} from "../utils/completion.js";
import { createOutputContext } from "../output/common.js";
import {
  renderCompletionScript as outputCompletionScript,
  renderCompletionQuery,
} from "../output/completion.js";

interface CompletionCommandOptions {
  shell?: string;
  query?: boolean;
  cword?: string;
}

function parseShell(shellValue: string): ReturnType<typeof detectCompletionShell> {
  if (!isCompletionShell(shellValue)) {
    throw new CLIError(
      `Unsupported shell '${shellValue}'.`,
      "INPUT",
      `Supported shells: ${SUPPORTED_COMPLETION_SHELLS.join(", ")}`
    );
  }
  return shellValue;
}

function parseCword(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CLIError(
      `Invalid --cword value '${raw}'.`,
      "INPUT",
      "Expected a non-negative integer."
    );
  }
  return parsed;
}

export async function handleCompletionCommand(
  shellArg: string | undefined,
  opts: CompletionCommandOptions,
  cmd: Command,
): Promise<void> {
  const root = cmd.parent;
  const globalOpts = root?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const ctx = createOutputContext(mode);
  const words = cmd.args as string[];

  try {
    if (opts.query) {
      const shellName = opts.shell ? parseShell(opts.shell) : detectCompletionShell();
      const cword = parseCword(opts.cword);
      const candidates = queryCompletionCandidates(words, cword);
      renderCompletionQuery(ctx, shellName, cword, candidates);
      return;
    }

    if (!root) {
      throw new CLIError(
        "Internal error in completion setup.",
        "UNKNOWN",
        "Please report this at https://github.com/0xmatthewb/privacy-pools-cli/issues",
      );
    }

    if (words.length > 1) {
      throw new CLIError(
        "Too many arguments for completion command.",
        "INPUT",
        "Use: privacy-pools completion [shell]",
      );
    }

    if (opts.shell && words.length === 1 && opts.shell !== words[0]) {
      throw new CLIError(
        "Conflicting shell values from --shell and positional argument.",
        "INPUT",
        "Specify shell either as positional argument or via --shell, but not both.",
      );
    }

    let shellName: ReturnType<typeof detectCompletionShell>;
    if (opts.shell) {
      shellName = parseShell(opts.shell);
    } else if (shellArg) {
      shellName = parseShell(shellArg);
    } else {
      shellName = detectCompletionShell();
    }

    const script = generateCompletionScript(shellName);
    outputCompletionScript(ctx, shellName, script);
  } catch (error) {
    printError(error, isJson);
  }
}
