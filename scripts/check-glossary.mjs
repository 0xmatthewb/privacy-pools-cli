import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const glossaryPath = join(repoRoot, "docs", "glossary.csv");
const rows = readFileSync(glossaryPath, "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [term, type, replacement = ""] = line.split(",");
    return { term, type, replacement };
  })
  .filter((row) => row.type === "banned" && row.term);

const files = execFileSync(
  "git",
  [
    "ls-files",
    "AGENTS.md",
    "docs",
    "skills",
    "src",
    ":!:docs/glossary.csv",
    ":!:src/utils/command-manifest.ts",
  ],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((path) => !path.includes("/generated/"));

const violations = [];

for (const file of files) {
  const text = readFileSync(join(repoRoot, file), "utf8");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("- pattern:")
    ) {
      return;
    }

    for (const { term, replacement } of rows) {
      if (line.includes(term)) {
        violations.push(`${file}:${index + 1}: replace "${term}" with "${replacement}"`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`Glossary violations found:\n${violations.join("\n")}`);
  process.exit(1);
}

console.log("Glossary check passed.");
