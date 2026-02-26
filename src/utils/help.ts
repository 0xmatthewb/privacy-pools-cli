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
    `  Get started:   ${chalk.cyan("privacy-pools init")}`,
    `  Full guide:    ${chalk.cyan("privacy-pools guide")}`,
    `  Command help:  ${chalk.cyan("privacy-pools <command> --help")}`,
    `  Local dev:     ${chalk.cyan("bun run dev -- <command>")}`,
    `  No install:    ${chalk.cyan("bunx @0xbow/privacy-pools-cli@latest <command>")}`,
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
    `  ${chalk.cyan("npm i -g @0xbow/privacy-pools-cli")}`,
    `  ${chalk.cyan("bun add -g @0xbow/privacy-pools-cli")}`,
    `  ${chalk.cyan("bunx @0xbow/privacy-pools-cli@latest status")}  ${chalk.dim("(one-off, no install)")}`,
    `  ${chalk.cyan("bun run dev -- status")}                         ${chalk.dim("(from repo checkout)")}`,
    `  ${chalk.cyan("privacy-pools completion zsh")}                   ${chalk.dim("(shell autocomplete)")}`,
    "",
    chalk.bold("Quick Start"),
    `  ${chalk.cyan("privacy-pools init")}`,
    `  ${chalk.cyan("privacy-pools pools --chain sepolia")}`,
    `  ${chalk.cyan("privacy-pools deposit 0.1 --asset ETH --chain sepolia")}`,
    `  ${chalk.cyan("privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient --chain sepolia")}`,
    "",
    chalk.bold("Workflow"),
    `  1. ${chalk.green("init")}         Set up wallet and config (run once)`,
    `  2. ${chalk.green("pools")}        Browse available pools`,
    `  3. ${chalk.green("deposit")}      Deposit into a pool`,
    `  4. ${chalk.green("sync")}         Sync on-chain state`,
    `  5. ${chalk.green("withdraw")}     Withdraw from a pool`,
    `  6. ${chalk.green("balance")}      Check balances`,
    `  7. ${chalk.green("accounts")}     View commitment details`,
    `  *  ${chalk.green("status")}       Check setup anytime`,
    `  *  ${chalk.green("ragequit")}     Emergency exit (sacrifices privacy)`,
    "",
    chalk.bold("Global Options"),
    `  ${chalk.yellow("--chain <name>")}    Target chain (ethereum, arbitrum, optimism, sepolia, op-sepolia)`,
    `  ${chalk.yellow("--rpc-url <url>")}   Override RPC URL`,
    `  ${chalk.yellow("--json")}            Machine-readable JSON output`,
    `  ${chalk.yellow("--agent")}           Agent-first mode (implies --json, --yes, --quiet)`,
    `  ${chalk.yellow("--yes")}             Skip confirmation prompts`,
    `  ${chalk.yellow("--quiet")}           Suppress spinners and non-essential output`,
    `  ${chalk.yellow("--verbose")}         Enable verbose/debug output`,
    `  ${chalk.yellow("--no-banner")}       Disable ASCII banner`,
    "",
    chalk.bold("Automation (Agents / Scripts)"),
    "  Use --json for structured output with non-interactive behavior (including machine help/version envelopes).",
    "  Use --agent for a single-flag non-interactive JSON mode.",
    "  Use --yes to skip interactive prompts.",
    "  Use --quiet to suppress spinners and chatter.",
    "  Use --unsigned to get transaction payloads without submitting.",
    "  Use --unsigned --unsigned-format tx to emit raw transaction payloads (value and valueHex).",
    "  Use --dry-run to validate inputs and generate proofs without submitting.",
    "",
    chalk.bold("Exit Codes"),
    `  ${chalk.green("0")}  Success`,
    `  ${chalk.red("1")}  Unknown/general error`,
    `  ${chalk.red("2")}  Input/validation error`,
    `  ${chalk.red("3")}  RPC/network error`,
    `  ${chalk.red("4")}  ASP service error`,
    `  ${chalk.red("5")}  Relayer error`,
    `  ${chalk.red("6")}  Proof generation error`,
    `  ${chalk.red("7")}  Contract revert`,
    "",
    chalk.dim("  Run privacy-pools <command> --help for command-specific details."),
  ].join("\n");
}

interface CommandHelpConfig {
  prerequisites?: string;
  jsonFields: string;
  jsonVariants?: string[];
}

export function commandHelpText(config: CommandHelpConfig): string {
  const lines: string[] = [];

  if (config.prerequisites) {
    lines.push("", "Prerequisites:");
    lines.push(`  Requires: ${config.prerequisites}`);
  }

  lines.push("", "JSON Output (--json):");
  lines.push(`  ${config.jsonFields}`);
  if (config.jsonVariants) {
    for (const variant of config.jsonVariants) {
      lines.push(`  ${variant}`);
    }
  }
  lines.push("  Errors: { errorCode, errorMessage, error: { code, category, message, hint, retryable } }");

  return lines.join("\n");
}
