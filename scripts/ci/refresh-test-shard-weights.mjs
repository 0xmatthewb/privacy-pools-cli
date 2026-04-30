import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT = resolve(ROOT, "scripts/ci/test-shard-weights.json");

function parseArgs(argv) {
  const parsed = {
    reports: [],
    output: DEFAULT_OUTPUT,
    target: "main",
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
      continue;
    }
    if (token === "--target") {
      const target = argv[++index]?.trim();
      if (!target) {
        throw new Error("--target requires a value");
      }
      parsed.target = target;
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

function addSample(path, durationMs, sampleCount = 1) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return;
  }

  const current = durationsByTest.get(path) ?? {
    totalDurationMs: 0,
    sampleCount: 0,
  };
  current.totalDurationMs += Math.round(durationMs) * Math.max(1, sampleCount);
  current.sampleCount += Math.max(1, sampleCount);
  durationsByTest.set(path, current);
}

for (const reportPath of args.reports) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  let usedFileSummaries = false;

  for (const summary of report.fileSummaries ?? []) {
    if (!summary?.path) {
      continue;
    }
    usedFileSummaries = true;
    const normalized = normalizePath(resolve(ROOT, summary.path));
    addSample(
      normalized,
      Number(summary.estimatedDurationMs),
      Number(summary.sampleCount) || 1,
    );
  }

  if (usedFileSummaries) {
    continue;
  }

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
      addSample(normalized, perTestDuration, 1);
    }
  }
}

const nextWeights = Object.fromEntries(
  [...durationsByTest.entries()]
    .map(([testPath, summary]) => [
      testPath,
      Math.max(
        1,
        Math.round(
          summary.totalDurationMs / summary.sampleCount,
        ),
      ),
    ])
    .sort((left, right) => left[0].localeCompare(right[0])),
);

function readExistingManifest(outputPath) {
  if (!existsSync(outputPath)) {
    return {};
  }
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

function buildNextManifest() {
  if (args.target === "main") {
    return nextWeights;
  }

  return {
    ...readExistingManifest(args.output),
    [args.target]: {
      weights: nextWeights,
    },
  };
}

writeFileSync(
  args.output,
  `${JSON.stringify(buildNextManifest(), null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Updated shard weights for ${Object.keys(nextWeights).length} test file(s) (${args.target}): ${args.output}\n`,
);
