import chalk from "chalk";
import { accent, accentBold, highlight, notice, subtle } from "./theme.js";
import {
  ROOT_HELP_FOOTER_ENTRIES,
  rootHelpFooterPlain as rootHelpFooterPlainValue,
} from "./root-help-footer.js";

type Section = "options" | "commands" | "arguments" | null;

const SECTION_HEADERS = new Set(["Options:", "Commands:", "Arguments:"]);

/* ── Root-level command groups (order determines display order) ── */

const EXPLORE_ORDER = ["pools", "activity", "stats", "status", "guide", "capabilities", "describe"];
const TRANSACT_ORDER = ["init", "flow", "deposit", "accounts", "migrate", "withdraw", "ragequit", "history", "sync"];
const TOOLING_ORDER = ["completion"];
const EXPLORE_SET = new Set(EXPLORE_ORDER);
const TRANSACT_SET = new Set(TRANSACT_ORDER);
const TOOLING_SET = new Set(TOOLING_ORDER);

const CMD_RE = /^(\s{2,})([a-z][\w-]*(?:\|[a-z][\w-]*)?(?:\s+\[[^\]]+\])?(?:\s+<[^>]+>)?)(\s{2,})(.+)$/i;

const ROOT_HELP_BASE_LINES = [
  "Usage: privacy-pools [options] [command]",
  "",
  "Privacy Pools: a compliant way to transact privately on Ethereum",
  "",
  "Options:",
  "  -V, --version        output the version number",
  "  -c, --chain <name>   Target chain (mainnet, arbitrum, optimism, ...)",
  "  -j, --json           Machine-readable JSON output on stdout",
  "  --format <format>    Output format: table (default), csv, json (choices:",
  '                       "table", "csv", "json")',
  "  -y, --yes            Skip confirmation prompts",
  "  -r, --rpc-url <url>  Override RPC URL",
  "  --agent              Machine-friendly mode (alias for --json --yes --quiet)",
  "  -q, --quiet          Suppress most human-readable success output; errors still print",
  "  -v, --verbose        Enable verbose/debug output",
  "  --no-banner          Disable ASCII banner output",
  "  --no-color           Disable colored output (also respects NO_COLOR env var)",
  "  --timeout <seconds>  Network/transaction timeout in seconds (default: 30)",
  "  -h, --help           display help for command",
  "",
  "Commands:",
  "  init                 Initialize wallet and configuration",
  "  flow                 Run the easy-path deposit-to-withdraw workflow",
  "  pools                List available pools and assets",
  "  deposit              Deposit into a pool",
  "  accounts             List your Pool Accounts (individual deposit lineages)",
  "                       with balances",
  "  migrate              Inspect legacy migration readiness on CLI-supported",
  "                       chains",
  "  withdraw             Withdraw from a pool",
  "  ragequit|exit        Publicly withdraw funds to your deposit address",
  "  history              Show chronological event history (deposits, withdrawals,",
  "                       ragequits)",
  "  sync                 Force-sync local account state from onchain events",
  "  status               Show configuration and check connection health",
  "  activity             Show public activity feed",
  "  stats                Show public statistics",
  "  guide                Show usage guide, workflow, and reference",
  "  capabilities         Describe CLI capabilities for agent discovery",
  "  describe             Describe one command for runtime agent introspection",
  "  completion           Generate shell completion script",
  "  help                 display help for command",
];

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

    const isRoot = entries.some(
      (entry) =>
        EXPLORE_SET.has(entry.name) ||
        TRANSACT_SET.has(entry.name) ||
        TOOLING_SET.has(entry.name),
    );
    if (!isRoot) {
      for (const entry of entries) result.push(...entry.lines.map(styleCmdLine));
      cmdBuffer = [];
      return;
    }

    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    function emitGroup(header: string, order: string[]): void {
      const group = order.filter((name) => byName.has(name)).map((name) => byName.get(name)!);
      if (group.length === 0) return;
      result.push(`  ${chalk.bold(header)}`);
      for (const entry of group) result.push(...entry.lines.map(styleCmdLine));
    }

    emitGroup("Explore (no wallet needed)", EXPLORE_ORDER);
    result.push("");
    emitGroup("Transact (run init first)", TRANSACT_ORDER);
    result.push("");
    emitGroup("Tooling", TOOLING_ORDER);

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

    if (trimmed === "") {
      if (section === "commands") {
        flushCommands();
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
        optBuffer = { header: accentBold(trimmed), lines: [] };
      } else if (section !== "commands" || !optBuffer) {
        flushDeferredOptions();
        result.push(accentBold(trimmed));
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

  flushCommands();
  flushDeferredOptions();

  return result.join("\n");
}

export function rootHelpBaseText(): string {
  return ROOT_HELP_BASE_LINES.join("\n");
}

export function rootHelpFooterPlain(): string {
  return rootHelpFooterPlainValue();
}

export function rootHelpFooter(): string {
  return [
    "",
    ...ROOT_HELP_FOOTER_ENTRIES.map(
      ([label, command]) => `  ${label.padEnd(18)}${accent(command)}`,
    ),
  ].join("\n");
}

export function rootHelpText(): string {
  return `${rootHelpBaseText()}\n${rootHelpFooterPlain()}`;
}
