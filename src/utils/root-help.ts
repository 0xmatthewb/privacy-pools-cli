import chalk from "chalk";
import { accent, accentBold, notice } from "./theme.js";
import {
  ROOT_HELP_FOOTER_ENTRIES,
  rootHelpFooterPlain as rootHelpFooterPlainValue,
} from "./root-help-footer.js";
import {
  ROOT_COMMAND_DESCRIPTIONS,
  ROOT_COMMAND_GROUPS,
  ROOT_COMMAND_HELP_LABELS,
  ROOT_COMMAND_ORDER,
  type RootCommandName,
} from "./root-command-groups.js";

type Section = "options" | "commands" | "arguments" | null;

const SECTION_HEADERS = new Set(["Options:", "Commands:", "Arguments:"]);
const GENERIC_SECTION_HEADER_RE = /^[A-Z][A-Za-z0-9 ()/\-]+:$/;

const ROOT_COMMAND_SET = new Set([
  ...ROOT_COMMAND_ORDER,
  "help",
]);

const CMD_RE = /^(\s{2,})([a-z][\w-]*(?:\|[a-z][\w-]*)?(?:\s+\[[^\]]+\])?(?:\s+<[^>]+>)?)(\s{2,})(.+)$/i;
const ROOT_HELP_COMMAND_INDENT = "  ";
const ROOT_HELP_COMMAND_WIDTH = 24;
const ROOT_HELP_DESCRIPTION_WIDTH = 56;

function wrapRootHelpDescription(text: string): string[] {
  if (text.length <= ROOT_HELP_DESCRIPTION_WIDTH) {
    return [text];
  }

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length <= ROOT_HELP_DESCRIPTION_WIDTH) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = word;
      continue;
    }
    lines.push(word);
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function formatRootHelpCommand(
  name: RootCommandName,
  description: string = ROOT_COMMAND_DESCRIPTIONS[name],
): string[] {
  const label = ROOT_COMMAND_HELP_LABELS[name];
  const descriptionLines = wrapRootHelpDescription(description);
  return descriptionLines.map((line, index) =>
    index === 0
      ? `${ROOT_HELP_COMMAND_INDENT}${label.padEnd(ROOT_HELP_COMMAND_WIDTH)}${line}`
      : `${" ".repeat(ROOT_HELP_COMMAND_INDENT.length + ROOT_HELP_COMMAND_WIDTH)}${line}`,
  );
}

function buildRootHelpBaseLines(): string[] {
  return [
    "Usage: privacy-pools [options] [command]",
    "",
    "Privacy Pools: a compliant way to transact privately on Ethereum",
    "",
    "Options:",
    "  -V, --version           output the version number",
    "  -c, --chain <name>      Target chain (mainnet, arbitrum, optimism, ...)",
    "  -j, --json              Machine-readable JSON output on stdout. After the",
    "                          command name, pass --json <fields> or --json=<fields>",
    "                          to select top-level fields.",
    "  -o, --output <format>   Output format: table (default), csv, json, yaml, wide,",
    '                          name (choices: "table", "csv", "json", "yaml", "wide",',
    '                          "name")',
    "  -y, --yes               Skip confirmation prompts",
    "  --web                   Open the primary explorer or portal link in your",
    "                          browser when available",
    "  --help-brief            Show condensed command help without the extended",
    "                          guide appendix",
    "  -r, --rpc-url <url>     Override RPC URL",
    "  --template <template>   Render structured output through a lightweight",
    "                          Mustache-style template with {{path.to.value}}",
    "                          placeholders and {{#items}}...{{/items}} list",
    "                          iteration",
    "  --agent                 Machine-friendly mode (alias for --json --yes --quiet)",
    "  -q, --quiet             Suppress human-oriented stderr output",
    "  -v, --verbose           Enable verbose/debug output (-v info, -vv debug, -vvv",
    "                          trace)",
    "  --no-progress           Suppress spinners/progress indicators (useful in CI)",
    "  --no-header             Suppress header rows in CSV and wide/tabular table",
    "                          output",
    "  --no-banner             Disable ASCII banner output",
    "  --no-color              Disable colored output (also respects NO_COLOR env",
    "                          var)",
    "  --timeout <seconds>     Network/transaction timeout in seconds (default: 30)",
    "  --jmes <expression>     Filter JSON output with a JMESPath expression (implies",
    "                          --json)",
    "  --jq <expression>       Compatibility alias for --jmes (JMESPath, not jq",
    "                          syntax)",
    "  --profile <name>        Use a named profile (separate wallet identity and",
    "                          config)",
    "  -h, --help              display help for command",
    "",
    "Commands:",
    ...ROOT_COMMAND_ORDER.flatMap((name) => formatRootHelpCommand(name)),
    "  help                    display help for command",
  ];
}

function styleCmdLine(line: string): string {
  const m = line.match(CMD_RE);
  if (!m) return line;
  const cmdText = m[2];
  const pipeIdx = cmdText.indexOf("|");
  const s = pipeIdx === -1
    ? accent(cmdText)
    : accent(cmdText.slice(0, pipeIdx)) + chalk.dim(cmdText.slice(pipeIdx));
  return `${m[1]}${s}${m[3]}${m[4]}`;
}

function styleExampleCommandLine(line: string): string {
  const commandLineMatch = line.match(/^(\s+)(privacy-pools(?:\s+.+)?)$/);
  if (!commandLineMatch) return line;
  return `${commandLineMatch[1]}${accent(commandLineMatch[2])}`;
}

export function styleCommanderHelp(raw: string): string {
  if (!raw.includes("Usage:")) return raw;

  const lines = raw.split("\n");
  let section: Section = null;
  let isRootHelp = false;
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

    const isRoot =
      isRootHelp &&
      entries.length > 0 &&
      entries.every((entry) => ROOT_COMMAND_SET.has(entry.name));
    if (!isRoot) {
      for (const entry of entries) result.push(...entry.lines.map(styleCmdLine));
      cmdBuffer = [];
      return;
    }

    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    function emitGroup(header: string, order: readonly RootCommandName[]): void {
      const group = order.filter((name) => byName.has(name)).map((name) => byName.get(name)!);
      if (group.length === 0) return;
      result.push(`  ${chalk.bold(header)}`);
      for (const entry of group) result.push(...entry.lines.map(styleCmdLine));
    }

    ROOT_COMMAND_GROUPS.forEach((group, index) => {
      if (index > 0) {
        result.push("");
      }
      emitGroup(group.heading, group.commands);
    });

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
      isRootHelp = usage === "privacy-pools [options] [command]";
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

    if (GENERIC_SECTION_HEADER_RE.test(trimmed)) {
      flushCommands();
      flushDeferredOptions();
      section = null;
      result.push(accentBold(trimmed));
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
        result.push(`${m[1]}${notice(m[2])}${m[3]}${m[4]}`);
        continue;
      }
      result.push(line);
      continue;
    }

    const styledExampleLine = styleExampleCommandLine(line);
    if (styledExampleLine !== line) {
      result.push(styledExampleLine);
      continue;
    }

    result.push(line);
  }

  flushCommands();
  flushDeferredOptions();

  return result.join("\n");
}

export function rootHelpBaseText(): string {
  return buildRootHelpBaseLines().join("\n");
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
