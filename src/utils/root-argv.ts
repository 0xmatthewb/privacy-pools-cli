import {
  ROOT_LONG_OPTIONS_WITH_INLINE_VALUE,
  ROOT_OPTIONS_WITH_VALUE,
  ROOT_WELCOME_BOOLEAN_FLAGS,
} from "./root-global-flags.js";
import {
  getParsedVerboseLevel as readParsedVerboseLevel,
  setParsedVerboseLevel,
} from "./verbose-level.js";
import type { GlobalOptions } from "../types.js";

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

function readBooleanEnv(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;
  return TRUE_ENV_VALUES.has(raw.trim().toLowerCase());
}

function applyEnvFallbackRootOptions(globalOpts: GlobalOptions): void {
  if (readBooleanEnv("PRIVACY_POOLS_AGENT")) {
    globalOpts.agent = true;
  }
  if (readBooleanEnv("PRIVACY_POOLS_QUIET")) {
    globalOpts.quiet = true;
  }
  if (readBooleanEnv("PRIVACY_POOLS_YES")) {
    globalOpts.yes = true;
  }
  if (readBooleanEnv("PRIVACY_POOLS_NO_PROGRESS")) {
    globalOpts.noProgress = true;
  }
}

export interface ParsedRootArgv {
  argv: string[];
  firstCommandToken: string | undefined;
  nonOptionTokens: string[];
  formatFlagValue: string | null;
  isJson: boolean;
  isCsvMode: boolean;
  isAgent: boolean;
  isUnsigned: boolean;
  isMachineMode: boolean;
  isStructuredOutputMode: boolean;
  isHelpLike: boolean;
  isVersionLike: boolean;
  isRootHelpInvocation: boolean;
  isQuiet: boolean;
  suppressBanner: boolean;
  isWelcome: boolean;
}

export interface ParsedRootPrelude {
  parsed: ParsedRootArgv;
  globalOpts: GlobalOptions;
  commandIndex: number | null;
}

interface ParsedRootPreludeTokenResult {
  consumedNext: boolean;
  helpLike: boolean;
  versionLike: boolean;
}

function rootArgvSliceRaw(args: string[]): string[] {
  const boundary = args.indexOf("--");
  return boundary === -1 ? args : args.slice(0, boundary);
}

function applyStructuredOutputFlagsFromTrailingArgs(
  args: readonly string[],
  startIndex: number,
  globalOpts: GlobalOptions,
): void {
  for (let index = startIndex; index < args.length; index++) {
    const token = args[index] ?? "";

    if (token === "--json-fields") {
      const nextToken = args[index + 1];
      if (typeof nextToken === "string" && !nextToken.startsWith("-")) {
        globalOpts.jsonFields = nextToken;
        globalOpts.json = true;
        index++;
      }
      continue;
    }

    if (typeof token === "string" && token.startsWith("--json-fields=")) {
      globalOpts.jsonFields = token.slice("--json-fields=".length);
      globalOpts.json = true;
      continue;
    }

    if (typeof token === "string" && token.startsWith("--json=")) {
      globalOpts.jsonFields = token.slice("--json=".length);
      globalOpts.json = true;
      continue;
    }

    if (token === "--json") {
      globalOpts.json = true;
      const nextToken = args[index + 1];
      if (typeof nextToken === "string" && !nextToken.startsWith("-")) {
        globalOpts.jsonFields = nextToken;
        index++;
      }
      continue;
    }

    if (token === "--template") {
      const nextToken = args[index + 1];
      if (typeof nextToken === "string") {
        globalOpts.template = nextToken;
        globalOpts.json = true;
        index++;
      }
      continue;
    }

    if (typeof token === "string" && token.startsWith("--template=")) {
      globalOpts.template = token.slice("--template=".length);
      globalOpts.json = true;
      continue;
    }

    if (token === "--jmes" || token === "--jq") {
      const nextToken = args[index + 1];
      if (typeof nextToken === "string") {
        if (token === "--jmes") {
          globalOpts.jmes = nextToken;
        } else {
          globalOpts.jq = nextToken;
        }
        index++;
      }
      continue;
    }

    if (typeof token === "string" && token.startsWith("--jmes=")) {
      globalOpts.jmes = token.slice("--jmes=".length);
      continue;
    }

    if (typeof token === "string" && token.startsWith("--jq=")) {
      globalOpts.jq = token.slice("--jq=".length);
      continue;
    }
  }
}

export function normalizeJsonFieldSelectionArgv(args: string[]): string[] {
  const boundary = args.indexOf("--");
  const head = boundary === -1 ? args : args.slice(0, boundary);
  const tail = boundary === -1 ? [] : args.slice(boundary);
  const normalized: string[] = [];
  let seenCommandToken = false;

  for (let index = 0; index < head.length; index++) {
    const token = head[index] ?? "";

    if (token.startsWith("--json=")) {
      normalized.push(`--json-fields=${token.slice("--json=".length)}`);
      continue;
    }

    if (
      token === "--json"
      && seenCommandToken
      && index + 1 < head.length
      && !(head[index + 1] ?? "").startsWith("-")
    ) {
      normalized.push("--json-fields", head[index + 1] ?? "");
      index++;
      continue;
    }

    normalized.push(token);
    if (!token.startsWith("-")) {
      seenCommandToken = true;
      continue;
    }
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) {
      const next = head[index + 1];
      if (next !== undefined) {
        normalized.push(next);
        index++;
      }
    }
  }

  return tail.length > 0 ? [...normalized, ...tail] : normalized;
}

export function rootArgvSlice(args: string[]): string[] {
  return rootArgvSliceRaw(normalizeJsonFieldSelectionArgv(args));
}

export function hasShortFlag(args: string[], flag: string): boolean {
  for (const token of rootArgvSlice(args)) {
    if (!token.startsWith("-") || token.startsWith("--")) continue;
    if (token === `-${flag}`) return true;
    // Support bundled short flags, e.g. -jy or -qV
    if (/^-[A-Za-z]+$/.test(token) && token.includes(flag)) return true;
  }
  return false;
}

export function hasLongFlag(args: string[], flag: string): boolean {
  return rootArgvSlice(args).some(
    (token) => token === flag || token.startsWith(`${flag}=`),
  );
}

export function readLongOptionValue(
  args: string[],
  flag: string,
): string | null {
  const rootArgs = rootArgvSlice(args);
  for (let i = 0; i < rootArgs.length; i++) {
    const token = rootArgs[i];
    if (token === flag) {
      return i + 1 < rootArgs.length ? (rootArgs[i + 1] ?? null) : null;
    }
    if (token.startsWith(`${flag}=`)) {
      return token.slice(flag.length + 1);
    }
  }
  return null;
}

export function readShortOptionValue(
  args: string[],
  flag: string,
): string | null {
  const rootArgs = rootArgvSlice(args);
  for (let i = 0; i < rootArgs.length; i++) {
    const token = rootArgs[i];
    if (token === flag) {
      return i + 1 < rootArgs.length ? (rootArgs[i + 1] ?? null) : null;
    }
  }
  return null;
}

export function allNonOptionTokens(args: string[]): string[] {
  const tokens: string[] = [];
  const rootArgs = rootArgvSlice(args);
  for (let i = 0; i < rootArgs.length; i++) {
    const token = rootArgs[i];
    if (!token.startsWith("-")) {
      tokens.push(token);
      continue;
    }
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) i++;
  }
  return tokens;
}

export function firstNonOptionToken(args: string[]): string | undefined {
  const rootArgs = rootArgvSlice(args);
  for (let i = 0; i < rootArgs.length; i++) {
    const token = rootArgs[i];
    if (!token.startsWith("-")) return token;
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) i++;
  }
  return undefined;
}

export function isWelcomeShortFlagBundle(token: string): boolean {
  if (!/^-[A-Za-z]+$/.test(token) || token.startsWith("--")) return false;
  return token
    .slice(1)
    .split("")
    .every((flag) => flag === "q" || flag === "v" || flag === "y");
}

export function isWelcomeFlagOnlyInvocation(args: string[]): boolean {
  const rootArgs = rootArgvSlice(args);
  if (rootArgs.length === 0) return true;
  for (let i = 0; i < rootArgs.length; i++) {
    const token = rootArgs[i];
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) {
      if (i + 1 >= rootArgs.length) return false;
      i++;
      continue;
    }
    if (ROOT_LONG_OPTIONS_WITH_INLINE_VALUE.some((flag) => token.startsWith(`${flag}=`))) {
      continue;
    }
    if (ROOT_WELCOME_BOOLEAN_FLAGS.has(token) || isWelcomeShortFlagBundle(token)) {
      continue;
    }
    return false;
  }
  return true;
}

export function parseRootPreludeLongOption(
  token: string,
  nextToken: string | undefined,
  globalOpts: GlobalOptions,
): ParsedRootPreludeTokenResult | null {
  const equalsIndex = token.indexOf("=");
  const name = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
  const inlineValue =
    equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);

  switch (name) {
    case "--json":
      globalOpts.json = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--json-fields":
      if (inlineValue !== undefined) {
        globalOpts.jsonFields = inlineValue;
        globalOpts.json = true;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken !== undefined && !nextToken.startsWith("-")) {
        globalOpts.jsonFields = nextToken;
        globalOpts.json = true;
        return { consumedNext: true, helpLike: false, versionLike: false };
      }
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--template":
      if (inlineValue !== undefined) {
        globalOpts.template = inlineValue;
        globalOpts.json = true;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken !== undefined) {
        globalOpts.template = nextToken;
        globalOpts.json = true;
        return { consumedNext: true, helpLike: false, versionLike: false };
      }
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--jq":
    case "--jmes":
      if (inlineValue !== undefined) {
        if (name === "--jmes") {
          globalOpts.jmes = inlineValue;
        } else {
          globalOpts.jq = inlineValue;
        }
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken === undefined) return null;
      if (name === "--jmes") {
        globalOpts.jmes = nextToken;
      } else {
        globalOpts.jq = nextToken;
      }
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "--agent":
      globalOpts.agent = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--quiet":
      globalOpts.quiet = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--yes":
      globalOpts.yes = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--web":
      globalOpts.web = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--help-brief":
      globalOpts.helpBrief = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--help-full":
      globalOpts.helpFull = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--verbose":
      globalOpts.verbose = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--no-progress":
      globalOpts.noProgress = true;
      return { consumedNext: false, helpLike: false, versionLike: false };
    case "--no-header":
      globalOpts.noHeader = true;
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
    case "--output":
      if (inlineValue !== undefined) {
        globalOpts.output = inlineValue;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken === undefined) return null;
      globalOpts.output = nextToken;
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
    case "--profile":
      if (inlineValue !== undefined) {
        globalOpts.profile = inlineValue;
        return { consumedNext: false, helpLike: false, versionLike: false };
      }
      if (nextToken === undefined) return null;
      globalOpts.profile = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    default:
      return null;
  }
}

export function parseRootPreludeShortOption(
  token: string,
  nextToken: string | undefined,
  globalOpts: GlobalOptions,
): ParsedRootPreludeTokenResult | null {
  switch (token) {
    case "-c":
      if (nextToken === undefined) return null;
      globalOpts.chain = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "-r":
      if (nextToken === undefined) return null;
      globalOpts.rpcUrl = nextToken;
      return { consumedNext: true, helpLike: false, versionLike: false };
    case "-o":
      if (nextToken === undefined) return null;
      globalOpts.output = nextToken;
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

export function parseRootPreludeShortFlagBundle(
  token: string,
  globalOpts: GlobalOptions,
): Omit<ParsedRootPreludeTokenResult, "consumedNext"> | null {
  let helpLike = false;
  let versionLike = false;

  for (const flag of token.slice(1)) {
    const parsed = parseRootPreludeShortOption(`-${flag}`, undefined, globalOpts);
    if (!parsed || parsed.consumedNext) {
      return null;
    }
    helpLike = helpLike || parsed.helpLike;
    versionLike = versionLike || parsed.versionLike;
  }

  return { helpLike, versionLike };
}

export function parseValidatedRootPrelude(
  argv: string[],
): ParsedRootPrelude | null {
  const normalizedArgv = normalizeJsonFieldSelectionArgv(argv);
  const rootArgs = rootArgvSliceRaw(normalizedArgv);
  const globalOpts: GlobalOptions = {};
  applyEnvFallbackRootOptions(globalOpts);
  let commandIndex: number | null = null;

  for (let index = 0; index < rootArgs.length; index++) {
    const token = rootArgs[index] ?? "";

    if (token === "--") {
      return null;
    }

    if (!token.startsWith("-")) {
      commandIndex = index;
      break;
    }

    if (token.startsWith("--")) {
      const parsed = parseRootPreludeLongOption(
        token,
        rootArgs[index + 1],
        globalOpts,
      );
      if (!parsed || parsed.helpLike || parsed.versionLike) {
        return null;
      }
      if (parsed.consumedNext) {
        index++;
      }
      continue;
    }

    const parsed =
      token.length === 2
        ? parseRootPreludeShortOption(token, rootArgs[index + 1], globalOpts)
        : parseRootPreludeShortFlagBundle(token, globalOpts);
    if (!parsed || parsed.helpLike || parsed.versionLike) {
      return null;
    }
    if ("consumedNext" in parsed && parsed.consumedNext) {
      index++;
    }
  }

  if (commandIndex !== null) {
    applyStructuredOutputFlagsFromTrailingArgs(
      rootArgs,
      commandIndex + 1,
      globalOpts,
    );
  }

  return {
    parsed: parseRootArgv(normalizedArgv),
    globalOpts,
    commandIndex,
  };
}

/**
 * Count `-v` / `--verbose` occurrences in argv for multi-level verbosity.
 * Supports bundled short flags (e.g. `-vv` = 2, `-vvv` = 3) and repeated
 * flags (`-v -v` = 2, `--verbose --verbose` = 2).
 */
function countVerboseFlags(argv: string[]): number {
  const rootArgs = rootArgvSlice(argv);
  let count = 0;
  for (const token of rootArgs) {
    if (token === "--verbose") {
      count++;
    } else if (token === "-v") {
      count++;
    } else if (/^-[A-Za-z]+$/.test(token) && !token.startsWith("--")) {
      // Bundled short flags: count each 'v'
      for (const ch of token.slice(1)) {
        if (ch === "v") count++;
      }
    }
  }
  return count;
}

/** Returns the verbose level computed during parseRootArgv (0, 1, 2, 3+). */
export function getParsedVerboseLevel(): number {
  return readParsedVerboseLevel();
}

export function parseRootArgv(argv: string[]): ParsedRootArgv {
  const normalizedArgv = normalizeJsonFieldSelectionArgv(argv);
  const rootArgs = rootArgvSliceRaw(normalizedArgv);
  const firstCommandToken = firstNonOptionToken(normalizedArgv);
  const nonOptionTokens = allNonOptionTokens(normalizedArgv);
  const formatFlagValue =
    (
      readLongOptionValue(normalizedArgv, "--output") ??
      readShortOptionValue(normalizedArgv, "-o")
    )?.toLowerCase() ?? null;
  const envAgent = readBooleanEnv("PRIVACY_POOLS_AGENT");
  const envQuiet = readBooleanEnv("PRIVACY_POOLS_QUIET");
  const isAgent = hasLongFlag(normalizedArgv, "--agent") || envAgent;
  const hasJq = hasLongFlag(normalizedArgv, "--jq");
  const hasJmes = hasLongFlag(normalizedArgv, "--jmes");
  const hasJsonFields = hasLongFlag(normalizedArgv, "--json-fields");
  const hasTemplate = hasLongFlag(normalizedArgv, "--template");
  const hasStreamJson = hasLongFlag(normalizedArgv, "--stream-json");
  const isJson =
    hasLongFlag(normalizedArgv, "--json") ||
    hasShortFlag(normalizedArgv, "j") ||
    formatFlagValue === "json" ||
    isAgent ||
    hasJq ||
    hasJmes ||
    hasJsonFields ||
    hasTemplate ||
    hasStreamJson;
  const isCsvMode = formatFlagValue === "csv" && !isJson;
  const isUnsigned = hasLongFlag(normalizedArgv, "--unsigned");
  const isMachineMode = isJson || isCsvMode || isUnsigned || isAgent;
  const isStructuredOutputMode = isJson || isUnsigned || isAgent;
  const isHelpLike =
    rootArgs.includes("--help") ||
    hasShortFlag(normalizedArgv, "h") ||
    firstCommandToken === "help";
  const isVersionLike =
    rootArgs.includes("--version") || hasShortFlag(normalizedArgv, "V");
  const isRootHelpInvocation =
    isHelpLike &&
    (nonOptionTokens.length === 0 ||
      (nonOptionTokens.length === 1 && nonOptionTokens[0] === "help"));
  const suppressBanner = rootArgs.includes("--no-banner");
  const isQuiet =
    rootArgs.includes("--quiet") ||
    hasShortFlag(normalizedArgv, "q") ||
    isAgent ||
    envQuiet;
  const isWelcome = isWelcomeFlagOnlyInvocation(normalizedArgv) && !isMachineMode;

  setParsedVerboseLevel(countVerboseFlags(normalizedArgv));

  return {
    argv: normalizedArgv,
    firstCommandToken,
    nonOptionTokens,
    formatFlagValue,
    isJson,
    isCsvMode,
    isAgent,
    isUnsigned,
    isMachineMode,
    isStructuredOutputMode,
    isHelpLike,
    isVersionLike,
    isRootHelpInvocation,
    isQuiet,
    suppressBanner,
    isWelcome,
  };
}
