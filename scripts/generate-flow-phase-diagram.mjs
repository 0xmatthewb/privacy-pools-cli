import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const outputPath = join(repoRoot, "AGENTS.md");
const mode = process.argv.includes("--check") ? "check" : "write";
const begin = "<!-- BEGIN: phase-diagram -->";
const end = "<!-- END: phase-diagram -->";

const graphModulePath = join(repoRoot, "dist", "services", "flow-phase-graph.js");
if (!existsSync(graphModulePath)) {
  console.error("Built flow phase graph not found. Run `npm run build` first.");
  process.exit(1);
}

const { FLOW_PHASE_GRAPH } = await import(pathToFileURL(graphModulePath).href);

function phaseLabel(phase) {
  return `\`${phase}\``;
}

function isGlobalEscapeEdge(edge) {
  return edge.to === "completed_public_recovery" || edge.to === "stopped_external";
}

function renderTreeFromGraph(root = "awaiting_funding") {
  const lines = [root];
  const visited = new Set([root]);

  function walk(phase, depth) {
    const children = FLOW_PHASE_GRAPH.edges.filter(
      (edge) => edge.from === phase && !isGlobalEscapeEdge(edge),
    );
    for (const edge of children) {
      const repeat = visited.has(edge.to);
      lines.push(`${"  ".repeat(depth)}-> ${edge.to}${repeat ? " (see above)" : ""}`);
      if (!repeat) {
        visited.add(edge.to);
        walk(edge.to, depth + 1);
      }
    }
  }

  walk(root, 1);
  return lines;
}

function sourceGroupLabel(edges) {
  const sources = new Set(edges.map((edge) => edge.from));
  const nonTerminal = FLOW_PHASE_GRAPH.nodes.filter(
    (phase) => !FLOW_PHASE_GRAPH.terminal.includes(phase),
  );
  if (
    sources.size === nonTerminal.length &&
    nonTerminal.every((phase) => sources.has(phase))
  ) {
    return "any non-terminal phase";
  }
  return [...sources].join(" | ");
}

function renderDiagram() {
  const escapeGroups = [
    {
      to: "completed_public_recovery",
      label: "flow ragequit",
    },
    {
      to: "stopped_external",
      label: "external spend or mutation detected",
    },
  ].map((group) => ({
    ...group,
    edges: FLOW_PHASE_GRAPH.edges.filter((edge) => edge.to === group.to),
  })).filter((group) => group.edges.length > 0);

  return [
    "```",
    ...renderTreeFromGraph(),
    "",
    ...escapeGroups.flatMap((group, index) => [
      ...(index === 0 ? [sourceGroupLabel(group.edges)] : []),
      `  -> ${group.to.padEnd(27)} (${group.label})`,
    ]),
    "```",
  ];
}

function renderTransitionTable() {
  const rows = [
    "| From | To | Trigger |",
    "| --- | --- | --- |",
    ...FLOW_PHASE_GRAPH.edges.map((edge) =>
      `| ${phaseLabel(edge.from)} | ${phaseLabel(edge.to)} | ${edge.trigger} |`,
    ),
  ];
  return rows;
}

const generated = [
  begin,
  "",
  "**Flow state machine:**",
  "",
  "The `phase` field in the flow JSON payload tracks the saved workflow state. Agents should use `phase` plus `nextActions` to determine what action is needed next.",
  "",
  ...renderDiagram(),
  "",
  "**Phase sets:**",
  "",
  `- Terminal: ${FLOW_PHASE_GRAPH.terminal.map(phaseLabel).join(", ")}`,
  `- Paused: ${FLOW_PHASE_GRAPH.paused.map(phaseLabel).join(", ")}`,
  "",
  "**Transitions:**",
  "",
  ...renderTransitionTable(),
  "",
  end,
].join("\n");

function replaceMarkedSection(source) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  if (start === -1 || finish === -1 || finish < start) {
    throw new Error(`Missing ${begin} / ${end} markers in AGENTS.md`);
  }
  return `${source.slice(0, start)}${generated}${source.slice(finish + end.length)}`;
}

const existing = readFileSync(outputPath, "utf8");
const next = replaceMarkedSection(existing);

if (mode === "write") {
  writeFileSync(outputPath, next);
  console.log(`Wrote ${outputPath}`);
} else if (existing !== next) {
  console.error("AGENTS.md flow phase diagram is out of date.");
  process.exit(1);
} else {
  console.log("AGENTS.md flow phase diagram is up to date.");
}
