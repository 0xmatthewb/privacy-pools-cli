import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { suiteUsesSharedBuiltWorkspaceSnapshot } from "./main-suite-plan.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";
import {
  cleanupSharedBuiltWorkspaceSnapshot,
  createSharedBuiltWorkspaceSnapshot,
} from "./test-workspace-snapshot.mjs";
import {
  collectTopUncoveredFiles,
  createCoverageExcludedSources,
  evaluateCoveragePolicy,
  normalizeCoveragePath,
  stripLcovSourceSearchAndHash,
} from "./lib/coverage-policy.mjs";

import {
  COVERAGE_SIGNAL_TESTS,
  COVERAGE_ISOLATED_SUITES,
  COVERAGE_MAIN_EXCLUDED_TESTS,
  COVERAGE_MAIN_TEST_TARGETS,
} from "./test-suite-manifest.mjs";
import { buildCoverageMainSuites } from "./coverage-suite-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");

const coverageRootDir = mkdtempSync(join(tmpdir(), "pp-coverage-"));
const keepCoverageRoot = process.env.PP_KEEP_COVERAGE_ROOT === "1";
const MAX_COVERAGE_LCOV_RETRIES = 3;
let sharedBuiltWorkspaceSnapshotRoot = null;
let cleanedUp = false;

class CoverageSuiteExitError extends Error {
  constructor(label, status) {
    super(`coverage suite ${label} exited with status ${status ?? "null"}`);
    this.name = "CoverageSuiteExitError";
    this.label = label;
    this.status = status;
  }
}
const EXCLUDED_SOURCES = createCoverageExcludedSources(ROOT);

function parseLcovFile(filePath) {
  const records = readFileSync(filePath, "utf8").split("end_of_record\n");
  const files = new Map();

  for (const record of records) {
    const sourceMatch = record.match(/^SF:(.+)$/m);
    if (!sourceMatch) continue;

    const source = normalizeCoveragePath(
      isAbsolute(stripLcovSourceSearchAndHash(sourceMatch[1]))
        ? stripLcovSourceSearchAndHash(sourceMatch[1])
        : resolve(ROOT, stripLcovSourceSearchAndHash(sourceMatch[1])),
    );
    const lineHits = files.get(source) ?? new Map();
    for (const line of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      const lineNumber = Number(line[1]);
      const hits = Number(line[2]);
      lineHits.set(lineNumber, Math.max(lineHits.get(lineNumber) ?? 0, hits));
    }
    files.set(source, lineHits);
  }

  return files;
}

function mergeCoverageMaps(...maps) {
  const merged = new Map();

  for (const map of maps) {
    for (const [source, lineHits] of map.entries()) {
      const target = merged.get(source) ?? new Map();
      for (const [lineNumber, hits] of lineHits.entries()) {
        target.set(lineNumber, Math.max(target.get(lineNumber) ?? 0, hits));
      }
      merged.set(source, target);
    }
  }

  return merged;
}

function serializeCoverageMapToLcov(coverageMap) {
  const records = [];
  const sources = Array.from(coverageMap.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const source of sources) {
    const lineHits = coverageMap.get(source);
    if (!lineHits) continue;

    records.push(`SF:${source}`);
    const lines = Array.from(lineHits.entries()).sort((a, b) => a[0] - b[0]);
    for (const [lineNumber, hits] of lines) {
      records.push(`DA:${lineNumber},${hits}`);
    }
    records.push("end_of_record");
  }

  return `${records.join("\n")}\n`;
}

function ensureSharedBuiltWorkspaceSnapshotRoot() {
  if (!sharedBuiltWorkspaceSnapshotRoot) {
    sharedBuiltWorkspaceSnapshotRoot = createSharedBuiltWorkspaceSnapshot(ROOT);
  }

  return sharedBuiltWorkspaceSnapshotRoot;
}

function cleanupCoverageResources() {
  if (cleanedUp) return;
  cleanedUp = true;

  cleanupSharedBuiltWorkspaceSnapshot(sharedBuiltWorkspaceSnapshotRoot);
  if (!keepCoverageRoot) {
    rmSync(coverageRootDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}

function exitWithCleanup(code) {
  cleanupCoverageResources();
  process.exit(code);
}

process.once("beforeExit", cleanupCoverageResources);
process.once("exit", cleanupCoverageResources);
process.once("SIGINT", () => exitWithCleanup(130));
process.once("SIGTERM", () => exitWithCleanup(143));

function buildCoverageSuiteEnv(tests, envOverrides = {}) {
  const sharedBuiltWorkspaceSnapshot =
    suiteUsesSharedBuiltWorkspaceSnapshot(tests)
      ? {
          PP_TEST_BUILT_WORKSPACE_SNAPSHOT:
            ensureSharedBuiltWorkspaceSnapshotRoot(),
        }
      : {};

  return buildTestRunnerEnv({
    ...sharedBuiltWorkspaceSnapshot,
    ...envOverrides,
  });
}

function runCoverageSuite(args, coverageDir, envOverrides = {}) {
  return spawnSync(
    "node",
    [
      RUNNER,
      ...args,
      "--timeout",
      "600000",
      "--process-timeout-ms",
      "900000",
      "--coverage",
      "--coverage-reporter",
      "lcov",
      "--coverage-dir",
      coverageDir,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: envOverrides,
    },
  );
}

function runCoverageSuiteWithFallback(label, tests, attempt = 1) {
  const attemptLabel = attempt === 1 ? label : `${label}-retry-${attempt}`;
  const coverageDir = join(coverageRootDir, attemptLabel);
  const homeDir = join(coverageRootDir, `home-${attemptLabel}`);
  mkdirSync(homeDir, { recursive: true });

  process.stdout.write(
    `[coverage] running ${attemptLabel}: ${tests.join(" ")}\n`,
  );

  const result = runCoverageSuite(
    tests,
    coverageDir,
    buildCoverageSuiteEnv(tests, {
      PRIVACY_POOLS_HOME: homeDir,
    }),
  );
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
  const lcovPath = join(coverageDir, "lcov.info");
  const wroteLcov = existsSync(lcovPath);
  if (result.status !== 0) {
    throw new CoverageSuiteExitError(label, result.status ?? 1);
  }
  if (wroteLcov) {
    return [lcovPath];
  }

  if (attempt < MAX_COVERAGE_LCOV_RETRIES) {
    process.stdout.write(
      `[coverage] ${label} emitted no lcov on attempt ${attempt}; retrying the same suite\n`,
    );
    return runCoverageSuiteWithFallback(label, tests, attempt + 1);
  }

  if (tests.length <= 1) {
    throw new Error(
      `Coverage suite ${label} completed without writing lcov.info`,
    );
  }

  const midpoint = Math.ceil(tests.length / 2);
  const left = tests.slice(0, midpoint);
  const right = tests.slice(midpoint);
  process.stdout.write(
    `[coverage] ${label} emitted no lcov after ${attempt} attempts; retrying as ${left.length}+${right.length} file batches\n`,
  );

  return [
    ...runCoverageSuiteWithFallback(`${label}-a`, left),
    ...runCoverageSuiteWithFallback(`${label}-b`, right),
  ];
}

try {
  const mainSuites = buildCoverageMainSuites({
    rootDir: ROOT,
    testTargets: COVERAGE_MAIN_TEST_TARGETS,
    commandSurfaceTests: COVERAGE_SIGNAL_TESTS,
    excludedTests: COVERAGE_MAIN_EXCLUDED_TESTS,
  });
  const coverageArtifacts = [];

  for (const suite of mainSuites) {
    coverageArtifacts.push(
      ...runCoverageSuiteWithFallback(suite.label, suite.tests),
    );
  }

  for (const suite of COVERAGE_ISOLATED_SUITES) {
    coverageArtifacts.push(
      ...runCoverageSuiteWithFallback(suite.label, suite.tests),
    );
  }

  const mergedCoverage = mergeCoverageMaps(
    ...coverageArtifacts.map((artifactPath) => parseLcovFile(artifactPath)),
  );

  if (keepCoverageRoot) {
    writeFileSync(
      join(coverageRootDir, "merged.lcov.info"),
      serializeCoverageMapToLcov(mergedCoverage),
      "utf8",
    );
    process.stdout.write(
      `coverage debug artifacts kept at ${coverageRootDir}\n`,
    );
  }

  const {
    failures,
    overallStats,
    thresholdResults,
    uninstrumentedSources,
  } = evaluateCoveragePolicy({
    rootDir: ROOT,
    coverageMap: mergedCoverage,
    excludedSources: EXCLUDED_SOURCES,
  });

  for (const threshold of thresholdResults) {
    if (threshold.failure) continue;
    const summary =
      `${threshold.stats.percent.toFixed(2)}% (${threshold.stats.linesHit}/${threshold.stats.linesFound})`;
    process.stdout.write(`coverage ${threshold.label}: ${summary}\n`);
  }

  if (failures.length > 0) {
    console.error("Coverage thresholds failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error(
      `Overall executable src coverage: ${overallStats.percent.toFixed(2)}% (${overallStats.linesHit}/${overallStats.linesFound})`,
    );
    if (uninstrumentedSources.length > 0) {
      console.error("Uninstrumented executable src files:");
      for (const source of uninstrumentedSources) {
        console.error(
          `- ${source.replace(`${normalizeCoveragePath(ROOT)}/`, "")}`,
        );
      }
    }
    console.error("Top uncovered files by missed line count:");
    for (const row of collectTopUncoveredFiles(mergedCoverage, {
      excludedSources: EXCLUDED_SOURCES,
    })) {
      console.error(
        `- ${row.source.replace(`${normalizeCoveragePath(ROOT)}/`, "")}: ${row.missed} missed (${row.percent.toFixed(2)}%, ${row.hit}/${row.total})`,
      );
    }
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof CoverageSuiteExitError) {
    console.error(error.message);
    process.exitCode = error.status ?? 1;
  } else {
    throw error;
  }
} finally {
  cleanupCoverageResources();
}
