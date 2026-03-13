import chalk from "chalk";
import { accent, accentBold, dangerTone, highlight, notice, subtle, successTone } from "./theme.js";

type Section = "options" | "commands" | "arguments" | null;

const SECTION_HEADERS = new Set(["Options:", "Commands:", "Arguments:"]);

/* ── Root-level command groups (order determines display order) ── */

const EXPLORE_ORDER = ["pools", "activity", "stats", "status", "guide", "capabilities", "describe"];
const TRANSACT_ORDER = ["init", "deposit", "withdraw", "ragequit", "accounts", "history", "sync"];
const EXPLORE_SET = new Set(EXPLORE_ORDER);
const TRANSACT_SET = new Set(TRANSACT_ORDER);

const CMD_RE = /^(\s{2,})([a-z][\w-]*(?:\|[a-z][\w-]*)?(?:\s+\[[^\]]+\])?(?:\s+<[^>]+>)?)(\s{2,})(.+)$/i;

function styleCmdLine(line: string): string {
  const m = line.match(CMD_RE);
  if (!m) return line;
  const cmdText = m[2];
  const pipeIdx = cmdText.indexOf("|");
  const s = pipeIdx === -1
    ? highlight(cmdText)
    : highlight(cmdText.slice(0, pipeIdx)) + chalk.dim(cmdText.slice(pipeIdx));
  return `${m[1]}${s}${m[3]}${m[4]}`;
}

export function styleCommanderHelp(raw: string): string {
  if (!raw.includes("Usage:")) return raw;

  const lines = raw.split("\n");
  let section: Section = null;
  const result: string[] = [];
  let cmdBuffer: string[] = [];
  let optBuffer: { header: string; lines: string[] } | null = null;

  function styleOptionLine(line: string): string {
    const m = line.match(/^(\s{2,})(-[^-].*?|--[a-zA-Z0-9][^ ]*(?: [^ ]+)?.*?)(\s{2,})(.+)$/);
    if (m) return `${m[1]}${notice(m[2])}${m[3]}${m[4]}`;
    return line;
  }

  function flushCommands(): void {
    if (cmdBuffer.length === 0) return;

    // Parse command entries (primary line + any continuation lines)
    type Entry = { name: string; lines: string[] };
    const entries: Entry[] = [];
    for (const line of cmdBuffer) {
      const m = line.match(/^  ([a-z][\w-]*)(?:\|[a-z][\w-]*)?\s/);
      if (m) {
        entries.push({ name: m[1], lines: [line] });
      } else if (entries.length > 0) {
        entries[entries.length - 1].lines.push(line);
      }
    }

    // Only group root-level commands; sub-commands pass through unsorted
    const isRoot = entries.some(
      (e) => EXPLORE_SET.has(e.name) || TRANSACT_SET.has(e.name),
    );
    if (!isRoot) {
      for (const e of entries) result.push(...e.lines.map(styleCmdLine));
      cmdBuffer = [];
      return;
    }

    const byName = new Map(entries.map((e) => [e.name, e]));

    function emitGroup(header: string, order: string[]): void {
      const group = order.filter((n) => byName.has(n)).map((n) => byName.get(n)!);
      if (group.length === 0) return;
      result.push(`  ${chalk.bold(header)}`);
      for (const e of group) result.push(...e.lines.map(styleCmdLine));
    }

    emitGroup("Explore (no wallet needed)", EXPLORE_ORDER);
    result.push("");
    emitGroup("Transact (run init first)", TRANSACT_ORDER);

    cmdBuffer = [];
  }

  function flushDeferredOptions(): void {
    if (!optBuffer) return;
    result.push(optBuffer.header);
    for (const line of optBuffer.lines) result.push(styleOptionLine(line));
    optBuffer = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // A blank line while inside a section ends it
    if (trimmed === "") {
      if (section === "commands") {
        flushCommands();
        // Emit deferred options now that commands are done
        flushDeferredOptions();
        section = null;
      }
      result.push(line);
      continue;
    }

    if (line.startsWith("Usage:")) {
      const usage = line.slice("Usage:".length).trim();
      section = null;
      result.push(`${accentBold("Usage:")} ${chalk.bold(usage)}`);
      continue;
    }

    if (SECTION_HEADERS.has(trimmed)) {
      section = trimmed.replace(":", "").toLowerCase() as Section;
      if (section === "options" && !optBuffer) {
        // Defer options — they'll be emitted after commands
        optBuffer = { header: accentBold(trimmed), lines: [] };
      } else {
        // Commands header: emit deferred options first if commands already flushed
        if (section === "commands" && optBuffer) {
          // Options were buffered but commands come next — keep deferring
        } else {
          flushDeferredOptions();
          result.push(accentBold(trimmed));
        }
      }
      continue;
    }

    if (section === "commands") {
      cmdBuffer.push(line);
      continue;
    }

    if (section === "options" && optBuffer) {
      optBuffer.lines.push(line);
      continue;
    }

    if (section === "options") {
      result.push(styleOptionLine(line));
      continue;
    }

    if (section === "arguments") {
      const m = line.match(/^(\s{2,})([a-zA-Z][\w-]*)(\s{2,})(.+)$/);
      if (m) {
        result.push(`${m[1]}${subtle(m[2])}${m[3]}${m[4]}`);
        continue;
      }
      result.push(line);
      continue;
    }

    result.push(line);
  }

  // Flush any remaining buffered sections
  flushCommands();
  flushDeferredOptions();

  return result.join("\n");
}

/**
 * Condensed welcome screen shown on bare `privacy-pools` (no args).
 * Orients the user quickly without the full Commander listing.
 */
export function welcomeScreen(): string {
  const lines = [
    chalk.bold("  Explore (no wallet needed)"),
    `    ${highlight("pools")}  ${highlight("activity")}  ${highlight("stats")}  ${highlight("status")}  ${highlight("guide")}  ${highlight("describe")}`,
    "",
    chalk.bold("  Transact (run init first)"),
    `    ${highlight("init")}  ${highlight("deposit")}  ${highlight("withdraw")}  ${highlight("ragequit")}  ${highlight("accounts")}  ${highlight("history")}  ${highlight("sync")}`,
    "",
    `  Get started:      ${accent("privacy-pools init")}`,
    `  Full guide:       ${accent("privacy-pools guide")}`,
    `  All commands:     ${accent("privacy-pools --help")}`,
  ];

  // Nudge from-source users to register the CLI commands on their PATH.
  if (process.env.npm_lifecycle_event) {
    const isBun = !!(process.versions.bun || process.env.npm_execpath?.includes("bun"));
    const linkCmd = isBun ? "bun link" : "npm link";
    lines.push(
      "",
      chalk.dim("  Running from source? Register the CLI on your PATH:"),
      chalk.dim(`    ${linkCmd}`),
    );
  }

  lines.push(
    "",
    notice("  This CLI is experimental. Use at your own risk."),
    notice("  For large transactions, use privacypools.com."),
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
    `  Full guide:       ${accent("privacy-pools guide")}`,
    `  Command help:     ${accent("privacy-pools <command> --help")}`,
    `  Agent discovery:  ${accent("privacy-pools capabilities")}`,
  ].join("\n");
}

/**
 * Full guide content - displayed by `privacy-pools guide`.
 * Contains the quick start, workflow, automation tips, and exit codes
 * that used to live in root --help.
 */
export function guideText(): string {
  return [
    accentBold("Privacy Pools: Quick Guide"),
    "",
    chalk.bold("Install & Run"),
    `  ${accent("npm i -g github:0xmatthewb/privacy-pools-cli")}`,
    `  ${accent("bun add -g github:0xmatthewb/privacy-pools-cli")}`,
    `  ${accent("privacy-pools status")}`,
    `  ${accent("bun run dev -- status")}                        ${chalk.dim("(from source, no global install)")}`,
    `  ${accent("privacy-pools completion zsh")}                   ${chalk.dim("(shell autocomplete)")}`,
    "",
    chalk.bold("Quick Start"),
    `  ${accent("privacy-pools init")}`,
    `  ${accent("privacy-pools pools")}                                          ${chalk.dim("(browse available pools)")}`,
    `  ${accent("privacy-pools deposit 0.1 ETH")}`,
    `  ${accent("privacy-pools accounts")}                                       ${chalk.dim("(confirm approved vs declined vs POA-needed)")}`,
    `  ${accent("privacy-pools withdraw 0.05 ETH --to 0xRecipient --from-pa PA-1")}`,
    chalk.dim("  Commands use your default chain (set during init). Add --chain <name> to override."),
    "",
    chalk.dim("  Deposits are reviewed by the ASP (Association Set Provider) before approval."),
    chalk.dim("  Most deposits are approved within 1 hour; some may take up to 7 days."),
    chalk.dim("  ASP approval is required for withdraw, including --direct. If a deposit is"),
    chalk.dim("  declined, use ragequit to exit publicly to the original deposit address."),
    "",
    chalk.bold("Two-Key Model"),
    `  Privacy Pools uses two keys:`,
    `  ${notice("Recovery phrase")}  keeps your deposits private (generated during init)`,
    `  ${notice("Signer key")}       pays gas and sends transactions (can be set later)`,
    `  These are independent. You can set the signer key later via env var.`,
    `  Note: ${notice("PRIVACY_POOLS_PRIVATE_KEY")} env var takes precedence over a saved key file.`,
    "",
    chalk.bold("Workflow"),
    `  1. ${highlight("init")}           Set up wallet and config (run once)`,
    `  2. ${highlight("pools")}          Browse available pools`,
    `  3. ${highlight("deposit")}        Deposit into a pool (vetting fee shown before confirming)`,
    `  4. ${highlight("accounts")}       Check deposit approval status and balances`,
    `  5. ${highlight("withdraw")}       Withdraw privately (once approved; fee shown before confirming)`,
    `  6. ${highlight("history")}        View transaction history`,
    `  *  ${highlight("status")}         Check setup and connection health (checks run by default)`,
    `  *  ${highlight("activity")}       Public onchain feed ${chalk.dim("(for your history, use 'history')")}`,
    `  *  ${highlight("ragequit")}       Public withdrawal. Returns funds to deposit address (alias: exit)`,
    `  *  ${highlight("withdraw quote")} Check relayer fees before withdrawing`,
    "",
    chalk.bold("Global Options"),
    `  ${notice("-c, --chain <name>")}    Target chain (mainnet, arbitrum, optimism; testnets: sepolia, op-sepolia)`,
    `  ${notice("-r, --rpc-url <url>")}   Override RPC URL`,
    `  ${notice("-j, --json")}            Machine-readable JSON output`,
    `  ${notice("--format <fmt>")}        Output format: table (default), csv, json`,
    `  ${notice("--no-color")}            Disable colored output (also respects NO_COLOR env var)`,
    `  ${notice("-y, --yes")}             Skip confirmation prompts`,
    `  ${notice("-q, --quiet")}           Suppress spinners and non-essential output`,
    `  ${notice("-v, --verbose")}         Enable verbose/debug output`,
    `  ${notice("--agent")}               Alias for --json --yes --quiet (agent/automation mode)`,
    `  ${notice("--timeout <seconds>")}  Network/transaction timeout (default: 30)`,
    `  ${notice("--no-banner")}           Disable ASCII banner`,
    "",
    chalk.bold("Environment Variables"),
    `  ${notice("PRIVACY_POOLS_PRIVATE_KEY")}   Signer key (takes precedence over saved signer key file)`,
    `  ${notice("PRIVACY_POOLS_HOME")}          Config directory override (default: ~/.privacy-pools)`,
    `  ${notice("PP_RPC_URL_<CHAIN>")}           Override RPC endpoint per chain (e.g. PP_RPC_URL_ARBITRUM)`,
    `  ${notice("PP_ASP_HOST_<CHAIN>")}          Override ASP endpoint per chain (e.g. PP_ASP_HOST_SEPOLIA)`,
    `  ${notice("PP_RELAYER_HOST_<CHAIN>")}      Override relayer endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_CIRCUITS_DIR")}   Override the circuit artifact cache directory`,
    `  ${notice("NO_COLOR")}                     Disable colored output (same as --no-color)`,
    `  ${notice("PP_NO_UPDATE_CHECK")}           Set to 1 to disable the update-available notification`,
    "",
    chalk.bold("Interaction Modes"),
    "  Human mode (default): interactive prompts + readable output.",
    "  Agent mode: --agent for structured JSON output, no prompts, no banners.",
    "  Equivalent to --json --yes --quiet.",
    "",
    chalk.bold("Advanced Modes"),
    `  ${notice("--unsigned")}   Build transaction payloads without signing or submitting.`,
    "             Requires init (recovery phrase) for deposit secret generation.",
    "             Does NOT require a signer key. The signing party provides their own.",
    `             Output includes ${chalk.dim("from: null")}. The signer fills in their address.`,
    `  ${notice("--unsigned")}           (default) Wrapped in JSON envelope: { schemaVersion, success, ... }`,
    `  ${notice("--unsigned tx")}        Raw transaction array: [{ to, data, value, chainId }]`,
    "             Raw format skips the envelope. Intended for direct piping to signing tools.",
    `  ${notice("--dry-run")}    Validate and generate proofs without submitting.`,
    "",
    chalk.bold("Troubleshooting"),
    "  Stale data?      Commands auto-sync; force a full re-sync with 'privacy-pools sync'.",
    "  ASP unreachable?  Check 'privacy-pools status' (health checks run by default).",
    "  Long proof time?  First proof may provision circuits into your CLI home (~60s). Subsequent proofs are faster.",
    "  Not approved?     Deposits are reviewed by the ASP. Most approve within 1 hour;",
    "                   some may require Proof of Association or be declined.",
    "                   Declined deposits must use ragequit to exit publicly.",
    "  Custom RPC?       Pass --rpc-url on any command, or save per-chain overrides in",
    `                   ~/.privacy-pools/config.json under ${chalk.dim('"rpcOverrides": { "<chainId>": "https://..." }')}.`,
    "",
    chalk.bold("Exit Codes"),
    `  ${successTone("0")}  Success`,
    `  ${dangerTone("1")}  Unknown/general error`,
    `  ${dangerTone("2")}  Input/validation error`,
    `  ${dangerTone("3")}  RPC/network error`,
    `  ${dangerTone("4")}  ASP (Association Set Provider) error`,
    `  ${dangerTone("5")}  Relayer error`,
    `  ${dangerTone("6")}  Proof generation error`,
    `  ${dangerTone("7")}  Contract revert`,
    "",
    chalk.bold("Using CLI with an Existing Website Account"),
    `  If you already use ${accent("privacypools.com")}, you can access the same account from the CLI:`,
    `  1. Export your 12/24-word recovery phrase from the website.`,
    `  2. Run: ${accent('privacy-pools init --mnemonic "word1 word2 ..."')}`,
    `  3. Set your signer key: ${accent("export PRIVACY_POOLS_PRIVATE_KEY=0x...")}`,
    `  4. Run: ${accent("privacy-pools accounts")}  ${chalk.dim("(syncs on-chain state automatically)")}`,
    `  Your Pool Accounts and balances will appear once synced.`,
    "",
    chalk.bold("Terminology"),
    `  ${notice("Recovery phrase")}          12/24-word mnemonic that controls private account state.`,
    `  ${notice("Signer key")}               Private key that pays gas and sends transactions.`,
    `  ${notice("Pool Account (PA)")}        Individual deposit lineage tracked for withdrawal/exit.`,
    `  ${notice("ASP status")}               ${successTone("approved")} (withdraw ready), ${notice("pending")} (waiting),`,
    `                                   ${notice("poi_required")} (complete Proof of Association),`,
    `                                   ${dangerTone("declined")} (ragequit only), ${subtle("unknown")} (unresolved).`,
    `  ${notice("Relayed withdrawal")}       Privacy-preserving withdrawal via a relayer (recommended).`,
    `  ${notice("Direct withdrawal")}        Non-private withdrawal; links deposit and withdrawal onchain.`,
    `  ${notice("Ragequit (exit alias)")}    Public, irreversible withdrawal to original deposit address.`,
    "",
    chalk.bold("Agent Integration"),
    `  For programmatic/agent use, run ${accent("privacy-pools capabilities --agent")} to discover`,
    "  commands, schemas, supported chains, error codes, and the recommended workflow.",
    `  Use ${accent("privacy-pools describe <command...> --agent")} to inspect one command at runtime.`,
    "",
    chalk.bold("Further Reading"),
    `  ${accent("docs/reference.md")}   Flags, configuration, environment variables, project structure`,
    `  ${accent("AGENTS.md")}           Agent integration guide, JSON payloads, unsigned mode`,
    `  ${accent("CHANGELOG.md")}        Release history and migration notes`,
    "",
    chalk.dim("  Run privacy-pools <command> --help for command-specific details."),
  ].join("\n");
}

export interface CommandHelpConfig {
  overview?: string[];
  examples?: string[];
  prerequisites?: string;
  jsonFields?: string;
  jsonVariants?: string[];
  supportsUnsigned?: boolean;
  supportsDryRun?: boolean;
  safetyNotes?: string[];
  agentWorkflowNotes?: string[];
}

export function commandHelpText(config: CommandHelpConfig): string {
  const lines: string[] = [];

  if (config.overview && config.overview.length > 0) {
    lines.push("", ...config.overview);
  }

  if (config.examples && config.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of config.examples) {
      lines.push(`  ${example}`);
    }
  }

  if (config.prerequisites) {
    lines.push("", "Prerequisites:");
    lines.push(`  Requires: ${config.prerequisites}`);
  }

  if (config.safetyNotes && config.safetyNotes.length > 0) {
    lines.push("", "Safety notes:");
    for (const note of config.safetyNotes) {
      lines.push(`  ${note}`);
    }
  }

  if (config.agentWorkflowNotes && config.agentWorkflowNotes.length > 0) {
    lines.push("", "Agent workflow:");
    for (const note of config.agentWorkflowNotes) {
      lines.push(`  ${note}`);
    }
  }

  if (config.jsonFields || (config.jsonVariants && config.jsonVariants.length > 0)) {
    lines.push("", "JSON output (--json):");
    if (config.jsonFields) {
      lines.push(`  ${config.jsonFields}`);
    }
    for (const variant of config.jsonVariants ?? []) {
      lines.push(`  ${variant}`);
    }
  }

  if (config.supportsUnsigned || config.supportsDryRun) {
    lines.push("", "Additional modes:");
    if (config.supportsUnsigned) {
      lines.push("  --unsigned builds transaction payloads without submitting.");
    }
    if (config.supportsDryRun) {
      lines.push("  --dry-run validates the operation without submitting it.");
    }
  }

  return lines.join("\n");
}
