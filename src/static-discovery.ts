import type { GlobalOptions } from "./types.js";
import { CLIError, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
import {
  parseRootArgv,
  parseRootPreludeLongOption,
  parseRootPreludeShortFlagBundle,
  parseRootPreludeShortOption,
  parseValidatedRootPrelude,
  type ParsedRootArgv,
} from "./utils/root-argv.js";
import {
  invalidOutputFormatMessage,
  isSupportedOutputFormat,
  resolveGlobalMode,
} from "./utils/mode.js";
import { GENERATED_STATIC_LOCAL_COMMANDS } from "./utils/command-routing-static.js";

const STATIC_DISCOVERY_COMMANDS = GENERATED_STATIC_LOCAL_COMMANDS.filter(
  (command): command is Exclude<(typeof GENERATED_STATIC_LOCAL_COMMANDS)[number], "completion"> =>
    command !== "completion",
);
const STATIC_DISCOVERY_COMMAND_SET = new Set<string>(STATIC_DISCOVERY_COMMANDS);

interface ParsedStaticCommand {
  command: (typeof STATIC_DISCOVERY_COMMANDS)[number];
  commandTokens: string[];
  globalOpts: GlobalOptions;
}

interface ParsedStaticCompletionQuery {
  globalOpts: GlobalOptions;
  shell: "bash" | "zsh" | "fish" | "powershell";
  cword: number | undefined;
  words: string[];
}

function staticGlobalOptsFromParsedRootArgv(
  parsed: ParsedRootArgv,
): GlobalOptions {
  return {
    json: parsed.isJson || undefined,
    agent: parsed.isAgent || undefined,
    quiet: parsed.isQuiet || undefined,
    format: parsed.formatFlagValue ?? undefined,
  };
}

function isKnownCompletionShell(
  value: string,
): value is ParsedStaticCompletionQuery["shell"] {
  return value === "bash" || value === "zsh" || value === "fish" || value === "powershell";
}

function detectStaticCompletionShell(
  envShell: string | undefined = process.env.SHELL,
): ParsedStaticCompletionQuery["shell"] {
  const raw = (envShell ?? "").toLowerCase();
  if (raw.includes("zsh")) return "zsh";
  if (raw.includes("fish")) return "fish";
  return "bash";
}

function fallbackJsonModeFromArgv(argv: string[]): boolean {
  return parseRootArgv(argv).isStructuredOutputMode;
}

function isQuietMode(globalOpts: GlobalOptions): boolean {
  const mode = resolveGlobalMode(globalOpts);
  return mode.isQuiet || mode.isJson || mode.isCsv;
}

function assertSupportedOutputFormat(globalOpts: GlobalOptions): void {
  if (
    globalOpts.format !== undefined &&
    !isSupportedOutputFormat(globalOpts.format)
  ) {
    throw new CLIError(
      invalidOutputFormatMessage(globalOpts.format),
      "INPUT",
      "Use --help to see usage and examples.",
    );
  }
}

function guardStaticCsvUnsupported(
  globalOpts: GlobalOptions,
  commandName: string,
): void {
  if (resolveGlobalMode(globalOpts).isCsv) {
    throw new CLIError(
      `--format csv is not supported for '${commandName}'.`,
      "INPUT",
      "CSV output is available for: pools, accounts, activity, stats, history.",
    );
  }
}

async function renderStaticCapabilities(globalOpts: GlobalOptions): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "capabilities");
  const { STATIC_CAPABILITIES_PAYLOAD } = await import(
    "./utils/command-discovery-static.js"
  );
  const payload = STATIC_CAPABILITIES_PAYLOAD;
  const mode = resolveGlobalMode(globalOpts);

  if (mode.isJson) {
    printJsonSuccess(payload);
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  process.stderr.write("\nPrivacy Pools CLI: Agent Capabilities\n\n");
  process.stderr.write("Commands:\n");
  for (const command of payload.commands) {
    const aliasStr = command.aliases
      ? ` (alias: ${command.aliases.join(", ")})`
      : "";
    process.stderr.write(
      `  ${command.name}${aliasStr}: ${command.description}\n`,
    );
    if (command.agentFlags) {
      process.stderr.write(
        `    Agent usage: privacy-pools ${command.usage ?? command.name} ${command.agentFlags}\n`,
      );
    }
  }

  process.stderr.write("\nGlobal Flags:\n");
  for (const flag of payload.globalFlags) {
    process.stderr.write(`  ${flag.flag}: ${flag.description}\n`);
  }

  process.stderr.write("\nTypical Agent Workflow:\n");
  for (const step of payload.agentWorkflow) {
    process.stderr.write(`  ${step}\n`);
  }
  process.stderr.write("\n");
}

async function renderStaticGuide(globalOpts: GlobalOptions): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "guide");
  const mode = resolveGlobalMode(globalOpts);
  const { guideText } = await import("./utils/help.js");

  if (mode.isJson) {
    printJsonSuccess({
      mode: "help",
      help: guideText(),
    });
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  process.stderr.write("\n");
  process.stderr.write(`${guideText()}\n`);
  process.stderr.write("\n");
}

function writeList(label: string, values: string[]): void {
  if (values.length === 0) return;
  process.stderr.write(`\n${label}:\n`);
  for (const value of values) {
    process.stderr.write(`  ${value}\n`);
  }
}

async function renderStaticDescribe(
  globalOpts: GlobalOptions,
  commandTokens: string[],
): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "describe");
  const mode = resolveGlobalMode(globalOpts);
  const {
    listStaticCommandPaths,
    resolveStaticCommandPath,
    STATIC_CAPABILITIES_PAYLOAD,
  } = await import("./utils/command-discovery-static.js");
  const commandPath = resolveStaticCommandPath(commandTokens);
  if (!commandPath) {
    throw new CLIError(
      `Unknown command path: ${commandTokens.join(" ")}`,
      "INPUT",
      `Valid command paths: ${listStaticCommandPaths().join(", ")}`,
    );
  }

  const descriptor = STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath];
  if (mode.isJson) {
    printJsonSuccess(descriptor);
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  const { accentBold } = await import("./utils/theme.js");
  process.stderr.write(`\n${accentBold(`Command: ${descriptor.command}`)}\n\n`);
  process.stderr.write(`Description: ${descriptor.description}\n`);
  process.stderr.write(`Usage: privacy-pools ${descriptor.usage}\n`);
  process.stderr.write(
    `Requires init: ${descriptor.requiresInit ? "yes" : "no"}\n`,
  );
  process.stderr.write(
    `Safe read-only: ${descriptor.safeReadOnly ? "yes" : "no"}\n`,
  );
  process.stderr.write(`Expected latency: ${descriptor.expectedLatencyClass}\n`);

  if (descriptor.aliases.length > 0) {
    process.stderr.write(`Aliases: ${descriptor.aliases.join(", ")}\n`);
  }

  writeList("Flags", descriptor.flags);
  writeList("Global flags", descriptor.globalFlags);
  writeList("Prerequisites", descriptor.prerequisites);
  writeList("Examples", descriptor.examples);

  if (descriptor.jsonFields) {
    process.stderr.write(`\nJSON fields:\n  ${descriptor.jsonFields}\n`);
  }

  writeList("JSON variants", descriptor.jsonVariants);
  writeList("Safety notes", descriptor.safetyNotes);
  writeList("Agent workflow", descriptor.agentWorkflowNotes);

  if (descriptor.supportsUnsigned || descriptor.supportsDryRun) {
    process.stderr.write("\nAdditional modes:\n");
    if (descriptor.supportsUnsigned) {
      process.stderr.write(
        "  --unsigned builds transaction payloads without submitting.\n",
      );
    }
    if (descriptor.supportsDryRun) {
      process.stderr.write(
        "  --dry-run validates the operation without submitting it.\n",
      );
    }
  }

  process.stderr.write("\n");
}

function parseStaticCommand(argv: string[]): ParsedStaticCommand | null {
  const prelude = parseValidatedRootPrelude(argv);
  if (!prelude) {
    return null;
  }
  return parseStaticCommandFromRootArgv(prelude.parsed);
}

function hasValidStaticRootPrelude(argv: string[]): boolean {
  return parseValidatedRootPrelude(argv) !== null;
}

function parseStaticCommandFromRootArgv(
  parsed: ParsedRootArgv,
): ParsedStaticCommand | null {
  const commandToken = parsed.firstCommandToken;
  if (!commandToken || parsed.isHelpLike || parsed.isVersionLike) return null;
  if (!STATIC_DISCOVERY_COMMAND_SET.has(commandToken)) return null;

  const command = commandToken as ParsedStaticCommand["command"];
  const commandTokens = parsed.nonOptionTokens.slice(1);
  if (command === "guide" && commandTokens.length > 0) return null;
  if (command === "capabilities" && commandTokens.length > 0) return null;
  if (command === "describe" && commandTokens.length === 0) return null;

  return {
    command,
    commandTokens,
    globalOpts: staticGlobalOptsFromParsedRootArgv(parsed),
  };
}

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

function parseCompletionQuery(
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

export async function runStaticRootHelp(isMachineMode: boolean): Promise<void> {
  const {
    rootHelpBaseText,
    rootHelpFooter,
    rootHelpText,
    styleCommanderHelp,
  } = await import("./utils/root-help.js");

  if (isMachineMode) {
    printJsonSuccess({
      mode: "help",
      help: rootHelpText(),
    });
    return;
  }

  process.stdout.write(
    `${styleCommanderHelp(rootHelpBaseText())}\n${rootHelpFooter()}\n`,
  );
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
