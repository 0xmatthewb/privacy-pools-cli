import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT = resolve(ROOT, "scripts/ci/test-shard-weights.json");

function parseArgs(argv) {
  const parsed = {
    reports: [],
    output: DEFAULT_OUTPUT,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--report") {
      const reportPath = argv[++index];
      if (!reportPath) {
        throw new Error("--report requires a value");
      }
      parsed.reports.push(reportPath);
      continue;
    }
    if (token === "--output") {
      const outputPath = argv[++index];
      if (!outputPath) {
        throw new Error("--output requires a value");
      }
      parsed.output = resolve(ROOT, outputPath);
    }
  }

  return parsed;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(`${ROOT}/`, "./");
}

const args = parseArgs(process.argv);
if (args.reports.length === 0) {
  throw new Error("At least one --report path is required");
}

const durationsByTest = new Map();

for (const reportPath of args.reports) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  for (const result of report.results ?? []) {
    if (!Array.isArray(result.tests) || result.tests.length === 0) {
      continue;
    }

    const perTestDuration = Math.max(
      1,
      Math.round(Number(result.durationMs) / result.tests.length),
    );

    for (const testPath of result.tests) {
      const normalized = normalizePath(resolve(ROOT, testPath));
      const existing = durationsByTest.get(normalized) ?? [];
      existing.push(perTestDuration);
      durationsByTest.set(normalized, existing);
    }
  }
}

const nextWeights = Object.fromEntries(
  [...durationsByTest.entries()]
    .map(([testPath, durations]) => [
      testPath,
      Math.max(
        1,
        Math.round(
          durations.reduce((total, duration) => total + duration, 0)
            / durations.length,
        ),
      ),
    ])
    .sort((left, right) => left[0].localeCompare(right[0])),
);

writeFileSync(args.output, `${JSON.stringify(nextWeights, null, 2)}\n`, "utf8");
process.stdout.write(
  `Updated shard weights for ${Object.keys(nextWeights).length} test file(s): ${args.output}\n`,
);
