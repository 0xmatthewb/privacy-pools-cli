import { CLIError } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { GENERATED_STATIC_LOCAL_COMMANDS } from "../utils/command-routing-static.js";
import {
  parseValidatedRootPrelude,
  type ParsedRootArgv,
} from "../utils/root-argv.js";
import {
  staticGlobalOptsFromParsedRootArgv,
} from "./guards.js";
import {
  detectCompletionShell,
  isCompletionShell,
} from "../utils/completion-shell.js";
import type {
  ParsedStaticCommand,
  ParsedStaticCompletionQuery,
} from "./types.js";

const STATIC_DISCOVERY_COMMANDS = GENERATED_STATIC_LOCAL_COMMANDS.filter(
  (command): command is ParsedStaticCommand["command"] => command !== "completion",
);
const STATIC_DISCOVERY_COMMAND_SET = new Set<string>(STATIC_DISCOVERY_COMMANDS);

export function isKnownCompletionShell(
  value: string,
): value is ParsedStaticCompletionQuery["shell"] {
  return isCompletionShell(value);
}

export function detectStaticCompletionShell(
  envShell: string | undefined = process.env.SHELL,
  platform: NodeJS.Platform = process.platform,
): ParsedStaticCompletionQuery["shell"] {
  return detectCompletionShell(envShell, platform);
}

export function parseStaticCommand(argv: string[]): ParsedStaticCommand | null {
  const prelude = parseValidatedRootPrelude(argv);
  if (!prelude) {
    return null;
  }
  return parseStaticCommandFromRootArgv(prelude.parsed, prelude.globalOpts);
}

export function hasValidStaticRootPrelude(argv: string[]): boolean {
  return parseValidatedRootPrelude(argv) !== null;
}

export function parseStaticCommandFromRootArgv(
  parsed: ParsedRootArgv,
  preludeGlobalOpts?: GlobalOptions,
): ParsedStaticCommand | null {
  const commandToken = parsed.firstCommandToken;
  if (!commandToken || parsed.isHelpLike || parsed.isVersionLike) return null;
  if (!STATIC_DISCOVERY_COMMAND_SET.has(commandToken)) return null;

  const command = commandToken as ParsedStaticCommand["command"];
  const commandTokens = parsed.nonOptionTokens.slice(1);
  if (command === "guide" && commandTokens.length > 0) return null;
  if (command === "capabilities" && commandTokens.length > 0) return null;

  return {
    command,
    commandTokens,
    globalOpts: staticGlobalOptsFromParsedRootArgv(parsed, preludeGlobalOpts),
  };
}

export function parseCompletionQuery(
  argv: string[],
): ParsedStaticCompletionQuery | null {
  const prelude = parseValidatedRootPrelude(argv);
  if (!prelude || prelude.parsed.firstCommandToken !== "completion") {
    return null;
  }

  let index = prelude.commandIndex;
  if (index === null || argv[index] !== "completion") {
    return null;
  }
  index += 1;
  const globalOpts = prelude.globalOpts;

  let shellFlag: string | undefined;
  let shellArg: string | undefined;
  let query = false;
  let cwordRaw: string | undefined;
  let words: string[] | null = null;

  for (; index < argv.length; index++) {
    const token = argv[index];

    if (token === "--") {
      words = argv.slice(index + 1);
      break;
    }

    if (token === "--query") {
      query = true;
      continue;
    }

    if (token === "--shell" || token === "-s") {
      if (argv[index + 1] === undefined) return null;
      shellFlag = argv[++index];
      continue;
    }

    if (token.startsWith("--shell=")) {
      shellFlag = token.slice("--shell=".length);
      continue;
    }

    if (token === "--cword") {
      if (argv[index + 1] === undefined) return null;
      cwordRaw = argv[++index];
      continue;
    }

    if (token.startsWith("--cword=")) {
      cwordRaw = token.slice("--cword=".length);
      continue;
    }

    if (token.startsWith("-")) return null;

    if (shellArg === undefined) {
      shellArg = token;
      continue;
    }

    return null;
  }

  if (!query || words === null) return null;
  if (shellFlag && shellArg && shellFlag !== shellArg) return null;

  const shellValue = shellFlag ?? shellArg;
  const shell = shellValue
    ? isKnownCompletionShell(shellValue)
      ? shellValue
      : null
    : detectStaticCompletionShell();
  if (!shell) {
    throw new CLIError(
      `Unsupported shell '${shellValue}'.`,
      "INPUT",
      "Supported shells: bash, zsh, fish, powershell",
    );
  }

  let cword: number | undefined;
  if (cwordRaw !== undefined) {
    const parsed = Number(cwordRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CLIError(
        `Invalid --cword value '${cwordRaw}'.`,
        "INPUT",
        "Expected a non-negative integer.",
      );
    }
    cword = parsed;
  }

  return { globalOpts, shell, cword, words };
}
