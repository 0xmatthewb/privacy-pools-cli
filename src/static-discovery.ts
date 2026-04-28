import { CLIError, printError } from "./utils/errors.js";
import {
  configureJsonEnvelopeWarnings,
  printJsonSuccess,
} from "./utils/json.js";
import {
  consumeOutputEnvironmentWarnings,
  installOutputAnsiGuards,
} from "./utils/terminal.js";
import { buildGuidePayload, guideText, resolveGuideTopic } from "./utils/help.js";
import {
  parseRootPreludeLongOption,
  parseRootPreludeShortFlagBundle,
  parseRootPreludeShortOption,
  parseValidatedRootPrelude,
  type ParsedRootArgv,
} from "./utils/root-argv.js";
import { resolveGlobalMode, setModeArgv } from "./utils/mode.js";
import {
  assertSupportedOutputFormat,
  fallbackJsonModeFromArgv,
  isQuietMode,
  preferStaticMachineOutput,
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
import {
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_PATHS,
} from "./utils/command-routing-static.js";

// Keep the static facade visibly anchored to the lazy source-of-truth modules:
// ./utils/command-discovery-static.js
// ./utils/root-help.js

function configureStaticOutputWarnings(): void {
  installOutputAnsiGuards();
  const warnings = consumeOutputEnvironmentWarnings();
  if (warnings.length > 0) {
    configureJsonEnvelopeWarnings(warnings);
  }
}

export async function runStaticDiscoveryCommand(
  argv: string[],
  parsedRootArgv?: ParsedRootArgv,
): Promise<boolean> {
  setModeArgv(argv);
  configureStaticOutputWarnings();
  let parsed: ParsedStaticCommand | null = null;
  try {
    const firstToken = parsedRootArgv?.firstCommandToken ?? argv[0];
    const secondToken = parsedRootArgv?.nonOptionTokens[1] ?? argv[1];
    const guideTopic =
      firstToken === "help" || firstToken === "guide"
        ? resolveGuideTopic(secondToken)
        : null;
    const helpTarget =
      firstToken === "help"
        ? secondToken
        : undefined;
    const isKnownHelpTarget = Boolean(
      helpTarget &&
        (GENERATED_COMMAND_PATHS.some(
          (path) => path === helpTarget || path.startsWith(`${helpTarget} `),
        ) || helpTarget in GENERATED_COMMAND_ALIAS_MAP),
    );
    if (guideTopic) {
      const prelude = parseValidatedRootPrelude(argv);
      const globalOpts = parsedRootArgv
        ? staticGlobalOptsFromParsedRootArgv(parsedRootArgv, prelude?.globalOpts)
        : prelude?.globalOpts ?? {};
      const mode = resolveGlobalMode(preferStaticMachineOutput(globalOpts));
      const help = guideText(guideTopic);
      if (mode.isJson) {
        printJsonSuccess(buildGuidePayload(guideTopic));
      } else if (!isQuietMode(preferStaticMachineOutput(globalOpts))) {
        process.stdout.write(`${help}\n`);
      }
      return true;
    }
    if (
      (parsedRootArgv?.firstCommandToken === "help" || argv[0] === "help") &&
      helpTarget &&
      !isKnownHelpTarget
    ) {
      const prelude = parseValidatedRootPrelude(argv);
      const globalOpts = parsedRootArgv
        ? staticGlobalOptsFromParsedRootArgv(parsedRootArgv, prelude?.globalOpts)
        : prelude?.globalOpts ?? {};
      const mode = resolveGlobalMode(preferStaticMachineOutput(globalOpts));
      const help = guideText(helpTarget);
      if (mode.isJson) {
        printJsonSuccess(buildGuidePayload(helpTarget));
      } else if (!isQuietMode(preferStaticMachineOutput(globalOpts))) {
        const { renderHumanGuideText } = await import("./output/discovery.js");
        renderHumanGuideText(help);
      }
      return true;
    }

    // When entering via the fast-path (parsedRootArgv provided), try to
    // also parse the prelude to recover --json [fields] and --jq values
    // that the simple ParsedRootArgv does not carry.
    const prelude = parseValidatedRootPrelude(argv);
    parsed = parsedRootArgv
      ? parseStaticCommandFromRootArgv(parsedRootArgv, prelude?.globalOpts)
      : parseStaticCommand(argv);
    if (!parsed) return false;
    parsed.globalOpts = preferStaticMachineOutput(parsed.globalOpts);
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
        ? resolveGlobalMode(preferStaticMachineOutput(parsed.globalOpts)).isJson
        : parsedRootArgv?.isJson ?? fallbackJsonModeFromArgv(argv),
    );
    return true;
  }
}

export async function runStaticCompletionQuery(
  argv: string[],
): Promise<boolean> {
  setModeArgv(argv);
  configureStaticOutputWarnings();
  let parsed: ParsedStaticCompletionQuery | null = null;
  try {
    parsed = parseCompletionQuery(argv);
    if (!parsed) return false;
    parsed.globalOpts = preferStaticMachineOutput(parsed.globalOpts);
    assertSupportedOutputFormat(parsed.globalOpts);

    const mode = resolveGlobalMode(parsed.globalOpts);
    if (mode.isCsv) {
      throw new CLIError(
        "--output csv is not supported for 'completion'.",
        "INPUT",
        "CSV output is available for: pools, accounts, activity, stats, history, recipients.",
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
        nextActions: [
          {
            command: "completion",
            reason: "Install managed shell completion after validating the generated candidates.",
            when: "after_completion",
            options: { install: true },
            cliCommand: "privacy-pools completion --agent --install",
          },
        ],
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
      parsed
        ? resolveGlobalMode(preferStaticMachineOutput(parsed.globalOpts)).isJson
        : fallbackJsonModeFromArgv(argv),
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
