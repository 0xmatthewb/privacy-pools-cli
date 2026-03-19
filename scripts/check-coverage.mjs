import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const coverageDir = mkdtempSync(join(tmpdir(), "pp-coverage-"));
const coverageFile = join(coverageDir, "lcov.info");

const thresholds = [
  { label: "services", prefix: "src/services/", min: 85 },
  { label: "utils", prefix: "src/utils/", min: 85 },
  { label: "output", prefix: "src/output/", min: 85 },
  { label: "config", prefix: "src/config/", min: 95 },
];

function parseCoverageByPrefix(prefix) {
  const records = readFileSync(coverageFile, "utf8").split("end_of_record\n");
  let linesFound = 0;
  let linesHit = 0;

  for (const record of records) {
    const sourceMatch = record.match(/^SF:(.+)$/m);
    if (!sourceMatch) continue;

    const normalizedSource = sourceMatch[1].replaceAll("\\", "/");
    if (!normalizedSource.includes(prefix)) continue;

    const foundMatch = record.match(/^LF:(\d+)$/m);
    const hitMatch = record.match(/^LH:(\d+)$/m);
    if (foundMatch) linesFound += Number(foundMatch[1]);
    if (hitMatch) linesHit += Number(hitMatch[1]);
  }

  return {
    linesFound,
    linesHit,
    percent: linesFound === 0 ? 100 : (linesHit / linesFound) * 100,
  };
}

try {
  const result = spawnSync(
    "node",
    [
      RUNNER,
      "./test/unit",
      "./test/services",
      "--coverage",
      "--coverage-reporter",
      "lcov",
      "--coverage-dir",
      coverageDir,
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const failures = [];
  for (const threshold of thresholds) {
    const stats = parseCoverageByPrefix(threshold.prefix);
    if (stats.percent < threshold.min) {
      failures.push(
        `${threshold.label}: ${stats.percent.toFixed(2)}% < ${threshold.min}% (${stats.linesHit}/${stats.linesFound})`
      );
    } else {
      process.stdout.write(
        `coverage ${threshold.label}: ${stats.percent.toFixed(2)}% (${stats.linesHit}/${stats.linesFound})\n`
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write("Coverage thresholds failed:\n");
    for (const failure of failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    process.exit(1);
  }
} finally {
  rmSync(coverageDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}
