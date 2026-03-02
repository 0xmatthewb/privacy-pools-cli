import chalk from "chalk";
import { accent, accentBold, highlight, subtle } from "./theme.js";

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
      return `${accentBold("Usage:")} ${chalk.bold(usage)}`;
    }

    if (SECTION_HEADERS.has(trimmed)) {
      section = trimmed.replace(":", "").toLowerCase() as Section;
      return accentBold(trimmed);
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
        return `${m[1]}${highlight(m[2])}${m[3]}${m[4]}`;
      }
      return line;
    }

    if (section === "arguments") {
      const m = line.match(/^(\s{2,})([a-zA-Z][\w-]*)(\s{2,})(.+)$/);
      if (m) {
        return `${m[1]}${subtle(m[2])}${m[3]}${m[4]}`;
      }
      return line;
    }

    return line;
  });

  return styled.join("\n");
}

/**
 * Condensed welcome screen shown on bare `privacy-pools` (no args).
 * Orients the user quickly without the full Commander listing.
 */
export function welcomeScreen(): string {
  const lines = [
    chalk.bold("  Explore (no wallet needed)"),
    `    ${highlight("pools")}  ${highlight("activity")}  ${highlight("stats")}  ${highlight("status")}  ${highlight("guide")}`,
    "",
    chalk.bold("  Transact (run init first)"),
    `    ${highlight("init")}  ${highlight("deposit")}  ${highlight("withdraw")}  ${highlight("ragequit")}  ${highlight("accounts")}  ${highlight("balance")}  ${highlight("history")}  ${highlight("sync")}`,
    "",
    `  Get started:      ${accent("privacy-pools init")}`,
    `  Short alias:      ${accent("pp init")}`,
    `  Full guide:       ${accent("privacy-pools guide")}`,
    `  All commands:     ${accent("privacy-pools --help")}`,
  ];

  // Nudge from-source users to register the CLI commands on their PATH.
  if (process.env.npm_lifecycle_event) {
    const linkCmd = process.versions.bun ? "bun link" : "npm link";
    lines.push(
      "",
      chalk.dim("  Running from source? Register the CLI on your PATH:"),
      chalk.dim(`    ${linkCmd}`),
    );
  }

  lines.push(
    "",
    chalk.yellow("  This CLI is experimental. Use at your own risk."),
    chalk.yellow("  For large transactions, use https://privacypools.com."),
  );

  return lines.join("\n");
}

/**
 * Brief footer for root --help. The full command listing is already
 * shown by Commander, so this just adds quick-start pointers.
 */
export function rootHelpFooter(): string {
  return [
    "",
    `  Get started:      ${accent("privacy-pools init")}`,
    `  Short alias:      ${accent("pp init")}`,
    `  Full guide:       ${accent("privacy-pools guide")}`,
    `  Command help:     ${accent("privacy-pools <command> --help")}`,
  ].join("\n");
}

/**
 * Full guide content - displayed by `privacy-pools guide`.
 * Contains the quick start, workflow, automation tips, and exit codes
 * that used to live in root --help.
 */
export function guideText(): string {
  return [
    accentBold("Privacy Pools \u2014 Quick Guide"),
    "",
    chalk.bold("Install & Run"),
    `  ${accent("npm i -g github:0xmatthewb/privacy-pools-cli")}`,
    `  ${accent("bun add -g github:0xmatthewb/privacy-pools-cli")}`,
    `  ${accent("pp status")}                                  ${chalk.dim("(short alias for privacy-pools)")}`,
    `  ${accent("bun run dev -- status")}                        ${chalk.dim("(from source, no global install)")}`,
    `  ${accent("privacy-pools completion zsh")}                   ${chalk.dim("(shell autocomplete)")}`,
    "",
    chalk.bold("Quick Start"),
    `  ${accent("privacy-pools init")}`,
    `  ${accent("privacy-pools pools --chain sepolia")}`,
    `  ${accent("privacy-pools deposit 0.1 --asset ETH --chain sepolia")}`,
    `  ${accent("privacy-pools accounts --chain sepolia")}              ${chalk.dim("(wait for Approved status)")}`,
    `  ${accent("privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient -p PA-1 --chain sepolia")}`,
    "",
    chalk.dim("  Deposits are reviewed by the ASP (Association Set Provider) before approval."),
    chalk.dim("  Most deposits are approved within 1 hour; some may take up to 7 days."),
    chalk.dim("  Only approved deposits can be withdrawn privately. Recent deposits may not"),
    chalk.dim("  appear in 'balance' until approved."),
    "",
    chalk.bold("Two-Key Model"),
    `  Privacy Pools uses two keys:`,
    `  ${chalk.yellow("Recovery phrase")}  \u2014 keeps your deposits private (generated during init)`,
    `  ${chalk.yellow("Wallet key")}       \u2014 pays gas and sends transactions (can be set later)`,
    `  These are independent. You can set the wallet key later via env var.`,
    `  Note: ${chalk.yellow("PRIVACY_POOLS_PRIVATE_KEY")} env var takes precedence over a saved key file.`,
    "",
    chalk.bold("Workflow"),
    `  1. ${highlight("init")}           Set up wallet and config (run once)`,
    `  2. ${highlight("pools")}          Browse available pools`,
    `  3. ${highlight("deposit")}        Deposit into a pool (a small review fee is collected)`,
    `  4. ${highlight("accounts")}       Check deposit approval status`,
    `  5. ${highlight("withdraw")}       Withdraw privately (once approved \u2014 fee shown before confirming)`,
    `  6. ${highlight("balance")}        Check balances (only approved deposits shown)`,
    `  7. ${highlight("history")}        View transaction history`,
    `  *  ${highlight("sync")}           Re-sync onchain state (most commands sync automatically)`,
    `  *  ${highlight("status")}         Check setup and connection health (checks run by default)`,
    `  *  ${highlight("activity")}       Public onchain feed ${chalk.dim("(for your history, use 'history')")}`,
    `  *  ${highlight("ragequit")}       Public exit — returns funds to deposit address, no privacy (alias: exit)`,
    `  *  ${highlight("withdraw quote")} Check relayer fees before withdrawing`,
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
    `  ${highlight("0")}  Success`,
    `  ${chalk.red("1")}  Unknown/general error`,
    `  ${chalk.red("2")}  Input/validation error`,
    `  ${chalk.red("3")}  RPC/network error`,
    `  ${chalk.red("4")}  ASP (Association Set Provider) error`,
    `  ${chalk.red("5")}  Relayer error`,
    `  ${chalk.red("6")}  Proof generation error`,
    `  ${chalk.red("7")}  Contract revert`,
    "",
    chalk.bold("Agent Integration"),
    `  For programmatic/agent use, run ${accent("privacy-pools capabilities --json")} to discover`,
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
