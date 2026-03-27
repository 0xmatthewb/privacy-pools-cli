const ROOT_LONG_OPTIONS_WITH_INLINE_VALUE = [
  "--chain",
  "--format",
  "--rpc-url",
  "--timeout",
] as const;

const WELCOME_BOOLEAN_FLAGS = new Set([
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "-y",
  "--yes",
  "--no-banner",
  "--no-color",
]);

export const ROOT_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "--chain",
  "--format",
  "-r",
  "--rpc-url",
  "--timeout",
]);

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

export function rootArgvSlice(args: string[]): string[] {
  const boundary = args.indexOf("--");
  return boundary === -1 ? args : args.slice(0, boundary);
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
    if (
      ROOT_LONG_OPTIONS_WITH_INLINE_VALUE.some((flag) =>
        token.startsWith(`${flag}=`),
      )
    ) {
      continue;
    }
    if (WELCOME_BOOLEAN_FLAGS.has(token) || isWelcomeShortFlagBundle(token)) {
      continue;
    }
    return false;
  }
  return true;
}

export function parseRootArgv(argv: string[]): ParsedRootArgv {
  const rootArgs = rootArgvSlice(argv);
  const firstCommandToken = firstNonOptionToken(argv);
  const nonOptionTokens = allNonOptionTokens(argv);
  const formatFlagValue =
    readLongOptionValue(argv, "--format")?.toLowerCase() ?? null;
  const isJson =
    hasLongFlag(argv, "--json") ||
    hasShortFlag(argv, "j") ||
    formatFlagValue === "json";
  const isCsvMode = formatFlagValue === "csv";
  const isAgent = hasLongFlag(argv, "--agent");
  const isUnsigned = hasLongFlag(argv, "--unsigned");
  const isMachineMode = isJson || isCsvMode || isUnsigned || isAgent;
  const isStructuredOutputMode = isJson || isUnsigned || isAgent;
  const isHelpLike =
    rootArgs.includes("--help") ||
    hasShortFlag(argv, "h") ||
    firstCommandToken === "help";
  const isVersionLike =
    rootArgs.includes("--version") || hasShortFlag(argv, "V");
  const isRootHelpInvocation =
    isHelpLike &&
    (nonOptionTokens.length === 0 ||
      (nonOptionTokens.length === 1 && nonOptionTokens[0] === "help"));
  const suppressBanner = rootArgs.includes("--no-banner");
  const isQuiet = rootArgs.includes("--quiet") || hasShortFlag(argv, "q");
  const isWelcome =
    isWelcomeFlagOnlyInvocation(argv) && (!isMachineMode || isCsvMode);

  return {
    argv,
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
