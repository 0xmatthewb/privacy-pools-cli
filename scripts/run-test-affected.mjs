import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_KIND_SUFFIXES = [
  "unit",
  "integration",
  "service",
  "services",
  "fuzz",
  "acceptance",
  "conformance",
];
const DEFAULT_LARGE_IMPACTED_LIMIT = 50;

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function walkFiles(root) {
  if (!existsSync(root)) return [];

  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    const stat = statSync(current);
    if (stat.isFile()) {
      files.push(relative(ROOT, current).replaceAll("\\", "/"));
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
      } else if (entry.isFile()) {
        files.push(relative(ROOT, entryPath).replaceAll("\\", "/"));
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function sourceNameCandidates(filePath) {
  const stem = basename(filePath).replace(/\.[cm]?tsx?$/, "");
  const firstSegment = stem.split(".")[0];
  return Array.from(new Set([stem, firstSegment].filter(Boolean)));
}

function testMatchesSource(testPath, sourceName) {
  const fileName = basename(testPath);
  return TEST_KIND_SUFFIXES.some((suffix) =>
    new RegExp(
      `^${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\.${suffix}\\.test\\.ts$`,
    ).test(fileName),
  );
}

const changedFiles = new Set([
  ...runGit(["diff", "--name-only", "origin/main...HEAD"]),
  ...runGit(["diff", "--name-only"]),
  ...runGit(["diff", "--name-only", "--cached"]),
]);
const allTests = walkFiles(join(ROOT, "test")).filter((filePath) =>
  filePath.endsWith(".test.ts"),
);
const impactedTests = new Set();

for (const filePath of changedFiles) {
  if (/^test\/.*\.test\.ts$/.test(filePath)) {
    impactedTests.add(filePath);
    continue;
  }

  if (!/^src\/.*\.tsx?$/.test(filePath)) {
    continue;
  }

  for (const sourceName of sourceNameCandidates(filePath)) {
    for (const testPath of allTests) {
      if (testMatchesSource(testPath, sourceName)) {
        impactedTests.add(testPath);
      }
    }
  }
}

const tests = [...impactedTests].sort((left, right) => left.localeCompare(right));
if (tests.length === 0) {
  process.stdout.write("No impacted tests found for the current changes.\n");
  process.exit(0);
}

const configuredLargeLimit = Number.parseInt(
  process.env.PP_TEST_AFFECTED_MAX_FILES ?? "",
  10,
);
const largeImpactedLimit = Number.isInteger(configuredLargeLimit) &&
    configuredLargeLimit > 0
  ? configuredLargeLimit
  : DEFAULT_LARGE_IMPACTED_LIMIT;
if (
  tests.length > largeImpactedLimit &&
  process.env.PP_TEST_AFFECTED_ALLOW_LARGE !== "1"
) {
  process.stdout.write(
    [
      `Found ${tests.length} impacted test file(s), which is too broad for targeted dev mode.`,
      "Run `npm test` for full validation, or set PP_TEST_AFFECTED_ALLOW_LARGE=1 to force the raw affected file list.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write(`Running ${tests.length} impacted test file(s):\n`);
for (const testPath of tests) {
  process.stdout.write(`  ${testPath}\n`);
}

const result = spawnSync("node", ["scripts/run-bun-tests.mjs", ...tests], {
  cwd: ROOT,
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}
process.kill(process.pid, result.signal ?? "SIGTERM");
