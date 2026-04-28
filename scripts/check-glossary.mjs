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
    const [term, type, replacement = "", matchStyle = "exact"] = line.split(",");
    return { term, type, replacement, matchStyle };
  })
  .filter((row) => row.type === "banned" && row.term);

const files = execFileSync(
  "git",
  [
    "ls-files",
    "AGENTS.md",
    "README.md",
    "docs",
    "native/shell/src",
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcherFor(row) {
  switch (row.matchStyle) {
    case "exact":
      return (line) => line.includes(row.term);
    case "case-insensitive": {
      const needle = row.term.toLowerCase();
      return (line) => line.toLowerCase().includes(needle);
    }
    case "word-boundary": {
      const pattern = row.term
        .trim()
        .split(/[\s_-]+/)
        .map(escapeRegex)
        .join("[\\s_-]+");
      const regex = new RegExp(`\\b${pattern}\\b`, "i");
      return (line) => regex.test(line);
    }
    default:
      throw new Error(
        `Unsupported glossary match-style '${row.matchStyle}' for '${row.term}'.`,
      );
  }
}

const bannedTerms = rows.map((row) => ({
  ...row,
  matches: matcherFor(row),
}));

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

    for (const { term, replacement, matches } of bannedTerms) {
      if (matches(line)) {
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
