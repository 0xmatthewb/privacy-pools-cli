import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const outputPath = join(repoRoot, "skills", "privacy-pools", "SKILL.md");
const mode = process.argv.includes("--check") ? "check" : "write";
const begin = "<!-- BEGIN: recovery-decision-table -->";
const end = "<!-- END: recovery-decision-table -->";

const tableModulePath = join(repoRoot, "dist", "utils", "error-recovery-table.js");
if (!existsSync(tableModulePath)) {
  console.error("Built error recovery table not found. Run `npm run build` first.");
  process.exit(1);
}

const { serializeErrorRecoveryTable } = await import(pathToFileURL(tableModulePath).href);
const table = serializeErrorRecoveryTable();
const rows = Object.entries(table)
  .filter(([, entry]) => entry.classification !== "terminal-input")
  .sort(([left], [right]) => left.localeCompare(right));

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

const generated = [
  begin,
  "",
  "| Symptom / code | First try | Fallback |",
  "| --- | --- | --- |",
  ...rows.map(([code, entry]) => {
    const firstTry =
      entry.classification === "retry-only" && entry.retry
        ? `${entry.firstTry} (${entry.retry.strategy})`
        : entry.firstTry;
    return `| \`${code}\` | ${escapeCell(firstTry)} | ${escapeCell(entry.fallback ?? "see error.hint")} |`;
  }),
  "",
  end,
].join("\n");

function replaceMarkedSection(source) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  if (start === -1 || finish === -1 || finish < start) {
    throw new Error(`Missing ${begin} / ${end} markers in SKILL.md`);
  }
  return `${source.slice(0, start)}${generated}${source.slice(finish + end.length)}`;
}

const existing = readFileSync(outputPath, "utf8");
const next = replaceMarkedSection(existing);

if (mode === "write") {
  writeFileSync(outputPath, next);
  console.log(`Wrote ${outputPath}`);
} else if (existing !== next) {
  console.error("SKILL.md recovery decision table is out of date.");
  process.exit(1);
} else {
  console.log("SKILL.md recovery decision table is up to date.");
}
