import type { GlobalOptions } from "./types.js";
import {
  buildCapabilitiesPayload,
  buildCommandDescriptor,
  listCommandPaths,
  resolveCommandPath,
} from "./utils/command-metadata.js";
import { CLIError, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
import { resolveGlobalMode } from "./utils/mode.js";
import {
  detectCompletionShell,
  isCompletionShell,
  queryCompletionCandidates,
} from "./utils/completion.js";
import { accentBold } from "./utils/theme.js";

interface ParsedStaticCommand {
  command: "capabilities" | "describe";
  commandTokens: string[];
  globalOpts: GlobalOptions;
}

interface ParsedStaticCompletionQuery {
  globalOpts: GlobalOptions;
  shell: ReturnType<typeof detectCompletionShell>;
  cword: number | undefined;
  words: string[];
}

function isQuietMode(globalOpts: GlobalOptions): boolean {
  const mode = resolveGlobalMode(globalOpts);
  return mode.isQuiet || mode.isJson || mode.isCsv;
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

function renderStaticCapabilities(globalOpts: GlobalOptions): void {
  guardStaticCsvUnsupported(globalOpts, "capabilities");
  const payload = buildCapabilitiesPayload();
  const mode = resolveGlobalMode(globalOpts);

  if (mode.isJson) {
    printJsonSuccess(payload);
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

function writeList(label: string, values: string[]): void {
  if (values.length === 0) return;
  process.stderr.write(`\n${label}:\n`);
  for (const value of values) {
    process.stderr.write(`  ${value}\n`);
  }
}

function renderStaticDescribe(
  globalOpts: GlobalOptions,
  commandTokens: string[],
): void {
  guardStaticCsvUnsupported(globalOpts, "describe");
  const mode = resolveGlobalMode(globalOpts);
  const commandPath = resolveCommandPath(commandTokens);
  if (!commandPath) {
    throw new CLIError(
      `Unknown command path: ${commandTokens.join(" ")}`,
      "INPUT",
      `Valid command paths: ${listCommandPaths().join(", ")}`,
    );
  }

  const descriptor = buildCommandDescriptor(commandPath);
  if (mode.isJson) {
    printJsonSuccess(descriptor);
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

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

function parseLongOption(
  token: string,
  nextToken: string | undefined,
  globalOpts: GlobalOptions,
): { consumedNext: boolean; helpLike: boolean; versionLike: boolean } | null {
  const equalsIndex = token.indexOf("=");
  const name = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
  const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);

  switch (name) {
    case "--json":
      globalOpts.json = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--agent":
      globalOpts.agent = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--quiet":
      globalOpts.quiet = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--yes":
      globalOpts.yes = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--verbose":
      globalOpts.verbose = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--no-banner":
    case "--no-color":
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--help":
      return { consumedNext: false, helpLike: true, versionLike: false };
    case "--version":
      return { consumedNext: false, helpLike: false, versionLike: true };
    case "--chain":
      if (inlineValue !== undefined) {
        globalOpts.chain = inlineValue;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken === undefined) return null;
      globalOpts.chain = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "--format":
      if (inlineValue !== undefined) {
        globalOpts.format = inlineValue;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken === undefined) return null;
      globalOpts.format = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "--rpc-url":
      if (inlineValue !== undefined) {
        globalOpts.rpcUrl = inlineValue;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken === undefined) return null;
      globalOpts.rpcUrl = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "--timeout":
      if (inlineValue !== undefined) {
        globalOpts.timeout = inlineValue;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken === undefined) return null;
      globalOpts.timeout = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    default:
      return null;
  }
}

function parseShortOption(
  token: string,
  nextToken: string | undefined,
  globalOpts: GlobalOptions,
): { consumedNext: boolean; helpLike: boolean; versionLike: boolean } | null {
  switch (token) {
    case "-c":
      if (nextToken === undefined) return null;
      globalOpts.chain = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "-r":
      if (nextToken === undefined) return null;
      globalOpts.rpcUrl = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "-j":
      globalOpts.json = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "-q":
      globalOpts.quiet = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "-v":
      globalOpts.verbose = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "-y":
      globalOpts.yes = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "-h":
      return { consumedNext: false, helpLike: true, versionLike: false };
    case "-V":
      return { consumedNext: false, helpLike: false, versionLike: true };
    default:
      return null;
  }
}

function parseShortFlagBundle(
  token: string,
  globalOpts: GlobalOptions,
): { helpLike: boolean; versionLike: boolean } | null {
  let helpLike = false;
  let versionLike = false;

  for (const flag of token.slice(1)) {
    const parsed = parseShortOption(`-${flag}`, undefined, globalOpts);
    if (!parsed || parsed.consumedNext) {
      return null;
    }
    helpLike = helpLike || parsed.helpLike;
    versionLike = versionLike || parsed.versionLike;
  }

  return { helpLike, versionLike };
}

function parseStaticCommand(argv: string[]): ParsedStaticCommand | null {
  const globalOpts: GlobalOptions = {};
  let command: ParsedStaticCommand["command"] | null = null;
  const commandTokens: string[] = [];
  let helpLike = false;
  let versionLike = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--") return null;

    if (token.startsWith("--")) {
      const parsed = parseLongOption(token, argv[i + 1], globalOpts);
      if (!parsed) return null;
      helpLike = helpLike || parsed.helpLike;
      versionLike = versionLike || parsed.versionLike;
      if (parsed.consumedNext) i++;
      continue;
    }

    if (token.startsWith("-")) {
      const parsed =
        token.length === 2
          ? parseShortOption(token, argv[i + 1], globalOpts)
          : parseShortFlagBundle(token, globalOpts);
      if (!parsed) return null;
      helpLike = helpLike || parsed.helpLike;
      versionLike = versionLike || parsed.versionLike;
      if ("consumedNext" in parsed && parsed.consumedNext) i++;
      continue;
    }

    if (!command) {
      if (token !== "capabilities" && token !== "describe") {
        return null;
      }
      command = token;
      continue;
    }

    commandTokens.push(token);
  }

  if (!command || helpLike || versionLike) return null;
  if (command === "capabilities" && commandTokens.length > 0) return null;
  if (command === "describe" && commandTokens.length === 0) return null;

  return { command, commandTokens, globalOpts };
}

export function runStaticDiscoveryCommand(argv: string[]): boolean {
  const parsed = parseStaticCommand(argv);
  if (!parsed) return false;

  try {
    if (parsed.command === "capabilities") {
      renderStaticCapabilities(parsed.globalOpts);
      return true;
    }

    renderStaticDescribe(parsed.globalOpts, parsed.commandTokens);
    return true;
  } catch (error) {
    printError(error, resolveGlobalMode(parsed.globalOpts).isJson);
    return true;
  }
}

function parseCompletionQuery(
  argv: string[],
): ParsedStaticCompletionQuery | null {
  const globalOpts: GlobalOptions = {};
  let index = 0;

  for (; index < argv.length; index++) {
    const token = argv[index];

    if (token === "completion") {
      index++;
      break;
    }

    if (token === "--") return null;

    if (token.startsWith("--")) {
      const parsed = parseLongOption(token, argv[index + 1], globalOpts);
      if (!parsed || parsed.helpLike || parsed.versionLike) return null;
      if (parsed.consumedNext) index++;
      continue;
    }

    if (token.startsWith("-")) {
      const parsed =
        token.length === 2
          ? parseShortOption(token, argv[index + 1], globalOpts)
          : parseShortFlagBundle(token, globalOpts);
      if (!parsed) return null;
      if (parsed.helpLike || parsed.versionLike) return null;
      if ("consumedNext" in parsed && parsed.consumedNext) index++;
      continue;
    }

    return null;
  }

  if (index >= argv.length) return null;

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
    ? isCompletionShell(shellValue)
      ? shellValue
      : null
    : detectCompletionShell();
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
  version: string,
): Promise<boolean> {
  let parsed: ParsedStaticCompletionQuery | null = null;
  try {
    parsed = parseCompletionQuery(argv);
    if (!parsed) return false;

    const mode = resolveGlobalMode(parsed.globalOpts);
    if (mode.isCsv) {
      throw new CLIError(
        "--format csv is not supported for 'completion'.",
        "INPUT",
        "CSV output is available for: pools, accounts, activity, stats, history.",
      );
    }

    const { createRootProgram } = await import("./program.js");
    const root = createRootProgram(version);
    const candidates = queryCompletionCandidates(root, parsed.words, parsed.cword);

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
    printError(error, resolveGlobalMode(parsed?.globalOpts).isJson);
    return true;
  }
}

export async function runStaticRootHelp(
  version: string,
  isMachineMode: boolean,
): Promise<void> {
  const { createRootProgram } = await import("./program.js");
  const { rootHelpFooter, styleCommanderHelp } = await import("./utils/help.js");
  const program = createRootProgram(version);
  const baseHelp = program.helpInformation().trimEnd();
  const help = `${baseHelp}\n${rootHelpFooter()}`;

  if (isMachineMode) {
    printJsonSuccess({
      mode: "help",
      help,
    });
    return;
  }

  process.stdout.write(`${styleCommanderHelp(baseHelp)}\n${rootHelpFooter()}\n`);
}
