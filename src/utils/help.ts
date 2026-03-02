import chalk from "chalk";

type Section = "options" | "commands" | "arguments" | null;

const SECTION_HEADERS = new Set(["Options:", "Commands:", "Arguments:"]);

export function styleCommanderHelp(raw: string): string {
  if (!raw.includes("Usage:")) return raw;

  const lines = raw.split("\n");
  let section: Section = null;

  const styled = lines.map((line) => {
    const trimmed = line.trim();

    if (line.startsWith("Usage:")) {
      const usage = line.slice("Usage:".length).trim();
      section = null;
      return `${chalk.bold.cyan("Usage:")} ${chalk.bold(usage)}`;
    }

    if (SECTION_HEADERS.has(trimmed)) {
      section = trimmed.replace(":", "").toLowerCase() as Section;
      return chalk.bold.cyan(trimmed);
    }

    if (trimmed === "") {
      return line;
    }

    if (section === "options") {
      const m = line.match(/^(\s{2,})(-[^-].*?|--[a-zA-Z0-9][^ ]*(?: [^ ]+)?.*?)(\s{2,})(.+)$/);
      if (m) {
        return `${m[1]}${chalk.yellow(m[2])}${m[3]}${m[4]}`;
      }
      return line;
    }

    if (section === "commands") {
      const m = line.match(/^(\s{2,})([a-z][\w-]*(?:\s+\[[^\]]+\])?(?:\s+<[^>]+>)?)(\s{2,})(.+)$/i);
      if (m) {
        return `${m[1]}${chalk.green(m[2])}${m[3]}${m[4]}`;
      }
      return line;
    }

    if (section === "arguments") {
      const m = line.match(/^(\s{2,})([a-zA-Z][\w-]*)(\s{2,})(.+)$/);
      if (m) {
        return `${m[1]}${chalk.magenta(m[2])}${m[3]}${m[4]}`;
      }
      return line;
    }

    return line;
  });

  return styled.join("\n");
}

/**
 * Minimal footer for root --help. Points users to the right places
 * without overwhelming them with a tutorial.
 */
export function rootHelpFooter(): string {
  return [
    "",
    chalk.bold("  Read-only (no wallet needed)"),
    `    ${chalk.green("pools")}  ${chalk.green("activity")}  ${chalk.green("stats")}  ${chalk.green("status")}  ${chalk.green("guide")}`,
    "",
    chalk.bold("  Wallet required (run init first)"),
    `    ${chalk.green("init")}  ${chalk.green("deposit")}  ${chalk.green("withdraw")}  ${chalk.green("ragequit")}  ${chalk.green("accounts")}  ${chalk.green("balance")}  ${chalk.green("history")}  ${chalk.green("sync")}`,
    "",
    `  Get started:      ${chalk.cyan("privacy-pools init")}`,
    `  Short alias:      ${chalk.cyan("pp init")}`,
    `  Full guide:       ${chalk.cyan("privacy-pools guide")}`,
    `  Command help:     ${chalk.cyan("privacy-pools <command> --help")}`,
    `  Advanced:         ${chalk.cyan("--dry-run, --unsigned, --agent (see 'privacy-pools guide')")}`,
  ].join("\n");
}

/**
 * Full guide content - displayed by `privacy-pools guide`.
 * Contains the quick start, workflow, automation tips, and exit codes
 * that used to live in root --help.
 */
export function guideText(): string {
  return [
    chalk.bold.cyan("Privacy Pools CLI - Quick Guide"),
    "",
    chalk.bold("Install & Run"),
    `  ${chalk.cyan("npm i -g github:0xmatthewb/privacy-pools-cli")}`,
    `  ${chalk.cyan("bun add -g github:0xmatthewb/privacy-pools-cli")}`,
    `  ${chalk.cyan("pp status")}                                  ${chalk.dim("(short alias for privacy-pools)")}`,
    `  ${chalk.cyan("bun run dev -- status")}                        ${chalk.dim("(from source, no global install)")}`,
    `  ${chalk.cyan("privacy-pools completion zsh")}                   ${chalk.dim("(shell autocomplete)")}`,
    "",
    chalk.bold("Quick Start"),
    `  ${chalk.cyan("privacy-pools init")}`,
    `  ${chalk.cyan("privacy-pools pools --chain sepolia")}`,
    `  ${chalk.cyan("privacy-pools deposit 0.1 --asset ETH --chain sepolia")}`,
    `  ${chalk.cyan("privacy-pools accounts --chain sepolia")}              ${chalk.dim("(wait for Approved status)")}`,
    `  ${chalk.cyan("privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient -p PA-1 --chain sepolia")}`,
    "",
    chalk.dim("  Deposits are reviewed by the ASP (Association Set Provider) before approval."),
    chalk.dim("  Most deposits are approved within 1 hour; some may take up to 7 days."),
    chalk.dim("  Only approved deposits can be withdrawn privately. Recent deposits may not"),
    chalk.dim("  appear in 'balance' until approved."),
    "",
    chalk.bold("Two-Key Model"),
    `  Privacy Pools uses two separate keys:`,
    `  ${chalk.yellow("Recovery phrase")}  — generates your deposit secrets (for privacy)`,
    `  ${chalk.yellow("Signer key")}       — signs onchain transactions (for execution)`,
    `  These are independent. You can set the signer key later via env var.`,
    `  Note: ${chalk.yellow("PRIVACY_POOLS_PRIVATE_KEY")} env var takes precedence over a saved signer key file.`,
    "",
    chalk.bold("Workflow"),
    `  1. ${chalk.green("init")}           Set up wallet and config (run once)`,
    `  2. ${chalk.green("pools")}          Browse available pools`,
    `  3. ${chalk.green("deposit")}        Deposit into a pool (vetting fee collected by the pool's ASP)`,
    `  4. ${chalk.green("accounts")}       Check Pool Account (PA) approval status`,
    `  5. ${chalk.green("withdraw")}       Withdraw from a pool (once approved — relay fee shown before confirming)`,
    `  6. ${chalk.green("balance")}        Check balances (only approved deposits shown)`,
    `  7. ${chalk.green("history")}        View transaction history`,
    `  *  ${chalk.green("sync")}           Re-sync onchain state (most commands sync automatically)`,
    `  *  ${chalk.green("status")}         Check setup and connection health (checks run by default)`,
    `  *  ${chalk.green("activity")}       Public onchain feed ${chalk.dim("(for your history, use 'history')")}`,
    `  *  ${chalk.green("ragequit")}       Public exit — returns funds to deposit address, no privacy (alias: exit)`,
    `  *  ${chalk.green("withdraw quote")} Check relayer fees before withdrawing`,
    "",
    chalk.bold("Global Options"),
    `  ${chalk.yellow("-c, --chain <name>")}    Target chain (mainnet, arbitrum, optimism; testnets: sepolia, op-sepolia)`,
    `  ${chalk.yellow("-r, --rpc-url <url>")}   Override RPC URL`,
    `  ${chalk.yellow("-j, --json")}            Machine-readable JSON output`,
    `  ${chalk.yellow("-y, --yes")}             Skip confirmation prompts`,
    `  ${chalk.yellow("-q, --quiet")}           Suppress spinners and non-essential output`,
    `  ${chalk.yellow("-v, --verbose")}         Enable verbose/debug output`,
    `  ${chalk.yellow("--agent")}               Alias for --json --yes --quiet (agent/automation mode)`,
    `  ${chalk.yellow("--no-banner")}            Disable ASCII banner`,
    "",
    chalk.bold("Environment Variables"),
    `  ${chalk.yellow("PRIVACY_POOLS_PRIVATE_KEY")}   Signer key (takes precedence over saved signer key file)`,
    `  ${chalk.yellow("PRIVACY_POOLS_HOME")}          Config directory override (default: ~/.privacy-pools)`,
    `  ${chalk.yellow("PP_RPC_URL_<CHAIN>")}           Override RPC endpoint per chain (e.g. PP_RPC_URL_ARBITRUM)`,
    `  ${chalk.yellow("PP_ASP_HOST_<CHAIN>")}          Override ASP endpoint per chain (e.g. PP_ASP_HOST_SEPOLIA)`,
    `  ${chalk.yellow("PP_RELAYER_HOST_<CHAIN>")}      Override relayer endpoint per chain`,
    "",
    chalk.bold("Interaction Modes"),
    "  Human mode (default): interactive prompts + readable output.",
    "  Agent mode: --json --yes for structured JSON output, no prompts.",
    "  Shorthand: --agent is equivalent to --json --yes --quiet.",
    "",
    chalk.bold("Advanced Modes"),
    `  ${chalk.yellow("--unsigned")}   Build transaction payloads without signing or submitting.`,
    "             Requires init (mnemonic) for deposit secret generation.",
    "             Does NOT require a signer key — the signing party provides their own.",
    `             Output includes ${chalk.dim("from: null")} — the signer fills in their address.`,
    `  ${chalk.yellow("--unsigned-format envelope")}  (default) Wrapped in JSON envelope: { schemaVersion, success, ... }`,
    `  ${chalk.yellow("--unsigned-format tx")}        Raw transaction array: [{ to, data, value, chainId }]`,
    "             Raw format skips the envelope — intended for direct piping to signing tools.",
    `  ${chalk.yellow("--dry-run")}    Validate and generate proofs without submitting.`,
    "",
    chalk.bold("Troubleshooting"),
    "  Stale data?      Run 'privacy-pools sync' to re-sync from onchain events.",
    "  ASP unreachable?  Check 'privacy-pools status' (health checks run by default).",
    "  Long proof time?  First proof downloads circuits (~60s). Subsequent proofs are faster.",
    "  Not approved?     Deposits are reviewed by the ASP. Most approve within 1 hour.",
    "  Custom RPC?       Pass --rpc-url on any command, or save per-chain overrides in",
    `                   ~/.privacy-pools/config.json under ${chalk.dim('"rpcOverrides": { "<chainId>": "https://..." }')}.`,
    "",
    chalk.bold("Exit Codes"),
    `  ${chalk.green("0")}  Success`,
    `  ${chalk.red("1")}  Unknown/general error`,
    `  ${chalk.red("2")}  Input/validation error`,
    `  ${chalk.red("3")}  RPC/network error`,
    `  ${chalk.red("4")}  ASP (Association Set Provider) error`,
    `  ${chalk.red("5")}  Relayer error`,
    `  ${chalk.red("6")}  Proof generation error`,
    `  ${chalk.red("7")}  Contract revert`,
    "",
    chalk.bold("Agent Integration"),
    `  For programmatic/agent use, run ${chalk.cyan("privacy-pools capabilities --json")} to discover`,
    "  commands, schemas, supported chains, error codes, and the recommended workflow.",
    "",
    chalk.dim("  Run privacy-pools <command> --help for command-specific details."),
  ].join("\n");
}

interface CommandHelpConfig {
  prerequisites?: string;
  jsonFields?: string;
  jsonVariants?: string[];
  supportsUnsigned?: boolean;
  supportsDryRun?: boolean;
}

export function commandHelpText(config: CommandHelpConfig): string {
  const lines: string[] = [];

  if (config.prerequisites) {
    lines.push("", "Prerequisites:");
    lines.push(`  Requires: ${config.prerequisites}`);
  }

  if (config.jsonFields) {
    lines.push("", "JSON output (--json):");
    lines.push(`  ${config.jsonFields}`);
  }

  return lines.join("\n");
}
