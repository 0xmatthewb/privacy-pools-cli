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

function renderDiagram() {
  return [
    "```",
    "awaiting_funding",
    "  -> depositing_publicly",
    "  -> awaiting_asp",
    "       -> paused_declined",
    "       -> paused_poa_required",
    "       -> approved_waiting_privacy_delay",
    "            -> approved_ready_to_withdraw",
    "                 -> withdrawing",
    "                      -> completed",
    "",
    "any non-terminal phase",
    "  -> completed_public_recovery  (flow ragequit)",
    "  -> stopped_external           (external spend or mutation detected)",
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
