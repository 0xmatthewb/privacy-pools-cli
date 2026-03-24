const ROOT_GLOBAL_FLAG_DESCRIPTIONS = {
  "-c, --chain <name>": "Target chain (mainnet, arbitrum, optimism, ...)",
  "-j, --json": "Machine-readable JSON output on stdout",
  "--format <format>": "Output format: table (default), csv, json",
  "-y, --yes": "Skip confirmation prompts",
  "-r, --rpc-url <url>": "Override RPC URL",
  "--agent": "Machine-friendly mode (alias for --json --yes --quiet)",
  "-q, --quiet": "Suppress non-essential stderr output",
  "--no-banner": "Disable ASCII banner output",
  "-v, --verbose": "Enable verbose/debug output",
  "--timeout <seconds>": "Network/transaction timeout in seconds (default: 30)",
  "--no-color": "Disable colored output (also respects NO_COLOR env var)",
} as const;

export type RootGlobalFlag = keyof typeof ROOT_GLOBAL_FLAG_DESCRIPTIONS;

export function rootGlobalFlagDescription(flag: RootGlobalFlag): string {
  return ROOT_GLOBAL_FLAG_DESCRIPTIONS[flag];
}
