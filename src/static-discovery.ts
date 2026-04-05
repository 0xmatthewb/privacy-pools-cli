import { CLIError, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
import {
  parseRootPreludeLongOption,
  parseRootPreludeShortFlagBundle,
  parseRootPreludeShortOption,
  type ParsedRootArgv,
} from "./utils/root-argv.js";
import { resolveGlobalMode } from "./utils/mode.js";
import {
  assertSupportedOutputFormat,
  fallbackJsonModeFromArgv,
  staticGlobalOptsFromParsedRootArgv,
} from "./static-discovery/guards.js";
import {
  detectStaticCompletionShell,
  hasValidStaticRootPrelude,
  isKnownCompletionShell,
  parseCompletionQuery,
  parseStaticCommand,
  parseStaticCommandFromRootArgv,
} from "./static-discovery/parser.js";
import {
  renderStaticCapabilities,
  renderStaticDescribe,
  renderStaticGuide,
  renderStaticRootHelp,
} from "./static-discovery/renderers.js";
import type {
  ParsedStaticCommand,
  ParsedStaticCompletionQuery,
} from "./static-discovery/types.js";

// Keep the static facade visibly anchored to the lazy source-of-truth modules:
// ./utils/command-discovery-static.js
// ./utils/root-help.js

export async function runStaticDiscoveryCommand(
  argv: string[],
  parsedRootArgv?: ParsedRootArgv,
): Promise<boolean> {
  let parsed: ParsedStaticCommand | null = null;
  try {
    parsed = parsedRootArgv
      ? parseStaticCommandFromRootArgv(parsedRootArgv)
      : parseStaticCommand(argv);
    if (!parsed) return false;
    assertSupportedOutputFormat(parsed.globalOpts);

    switch (parsed.command) {
      case "guide":
        await renderStaticGuide(parsed.globalOpts);
        return true;
      case "capabilities":
        await renderStaticCapabilities(parsed.globalOpts);
        return true;
      case "describe":
        await renderStaticDescribe(parsed.globalOpts, parsed.commandTokens);
        return true;
    }
  } catch (error) {
    printError(
      error,
      parsed
        ? resolveGlobalMode(parsed.globalOpts).isJson
        : parsedRootArgv?.isJson ?? fallbackJsonModeFromArgv(argv),
    );
    return true;
  }
}

export async function runStaticCompletionQuery(
  argv: string[],
): Promise<boolean> {
  let parsed: ParsedStaticCompletionQuery | null = null;
  try {
    parsed = parseCompletionQuery(argv);
    if (!parsed) return false;
    assertSupportedOutputFormat(parsed.globalOpts);

    const mode = resolveGlobalMode(parsed.globalOpts);
    if (mode.isCsv) {
      throw new CLIError(
        "--format csv is not supported for 'completion'.",
        "INPUT",
        "CSV output is available for: pools, accounts, activity, stats, history.",
      );
    }

    const { queryCompletionCandidates } = await import(
      "./utils/completion-query.js"
    );
    const candidates = queryCompletionCandidates(parsed.words, parsed.cword);

    if (mode.isJson) {
      printJsonSuccess({
        mode: "completion-query",
        shell: parsed.shell,
        cword: parsed.cword,
        candidates,
      });
      return true;
    }

    if (candidates.length > 0) {
      process.stdout.write(`${candidates.join("\n")}\n`);
    }
    return true;
  } catch (error) {
    printError(
      error,
      parsed ? resolveGlobalMode(parsed.globalOpts).isJson : fallbackJsonModeFromArgv(argv),
    );
    return true;
  }
}

export async function runStaticRootHelp(
  isMachineMode: boolean,
): Promise<void> {
  await renderStaticRootHelp(isMachineMode);
}

export const staticDiscoveryTestInternals = {
  isKnownCompletionShell,
  detectStaticCompletionShell,
  fallbackJsonModeFromArgv,
  hasValidStaticRootPrelude,
  staticGlobalOptsFromParsedRootArgv,
  parseLongOption: parseRootPreludeLongOption,
  parseShortOption: parseRootPreludeShortOption,
  parseShortFlagBundle: parseRootPreludeShortFlagBundle,
  parseStaticCommand,
  parseStaticCommandFromRootArgv,
  parseCompletionQuery,
};
