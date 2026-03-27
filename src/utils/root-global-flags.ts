export const ROOT_GLOBAL_FLAG_METADATA = [
  {
    flag: "-c, --chain <name>",
    description: "Target chain (mainnet, arbitrum, optimism, ...)",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "-j, --json",
    description: "Machine-readable JSON output on stdout",
    takesValue: false,
    welcomeBoolean: false,
  },
  {
    flag: "--format <format>",
    description: "Output format: table (default), csv, json",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "-y, --yes",
    description: "Skip confirmation prompts",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "-r, --rpc-url <url>",
    description: "Override RPC URL",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "--agent",
    description: "Machine-friendly mode (alias for --json --yes --quiet)",
    takesValue: false,
    welcomeBoolean: false,
  },
  {
    flag: "-q, --quiet",
    description: "Suppress most human-readable success output; errors still print",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--no-banner",
    description: "Disable ASCII banner output",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "-v, --verbose",
    description: "Enable verbose/debug output",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--timeout <seconds>",
    description: "Network/transaction timeout in seconds (default: 30)",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "--no-color",
    description: "Disable colored output (also respects NO_COLOR env var)",
    takesValue: false,
    welcomeBoolean: true,
  },
] as const;

export type RootGlobalFlagMetadata = (typeof ROOT_GLOBAL_FLAG_METADATA)[number];
export type RootGlobalFlag = RootGlobalFlagMetadata["flag"];

function splitFlagNames(flag: string): string[] {
  return flag
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

const ROOT_GLOBAL_FLAG_DESCRIPTIONS = new Map(
  ROOT_GLOBAL_FLAG_METADATA.map(({ flag, description }) => [flag, description]),
);

export const ROOT_OPTIONS_WITH_VALUE = new Set(
  ROOT_GLOBAL_FLAG_METADATA.filter(({ takesValue }) => takesValue).flatMap(
    ({ flag }) => splitFlagNames(flag),
  ),
);

export const ROOT_LONG_OPTIONS_WITH_INLINE_VALUE = ROOT_GLOBAL_FLAG_METADATA
  .filter(({ takesValue }) => takesValue)
  .flatMap(({ flag }) => splitFlagNames(flag).filter((name) => name.startsWith("--")));

export const ROOT_WELCOME_BOOLEAN_FLAGS = new Set(
  ROOT_GLOBAL_FLAG_METADATA.filter(({ welcomeBoolean }) => welcomeBoolean).flatMap(
    ({ flag }) => splitFlagNames(flag),
  ),
);

export function rootGlobalFlagDescription(flag: RootGlobalFlag): string {
  const description = ROOT_GLOBAL_FLAG_DESCRIPTIONS.get(flag);
  if (!description) {
    throw new Error(`Unknown root global flag: ${flag}`);
  }
  return description;
}
