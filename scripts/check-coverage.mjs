import { spawn } from "node:child_process";
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
  collectCoverageScorecard,
  createCoverageExcludedSources,
  evaluateCoveragePolicy,
  normalizeCoveragePath,
  RISK_COVERAGE_SCORECARD,
  stripLcovSourceSearchAndHash,
} from "./lib/coverage-policy.mjs";

import {
  COVERAGE_SIGNAL_TESTS,
  COVERAGE_ISOLATED_SUITES,
  COVERAGE_MAIN_EXCLUDED_TESTS,
  COVERAGE_MAIN_TEST_TARGETS,
} from "./test-suite-manifest.mjs";
import { buildCoverageMainSuites } from "./coverage-suite-plan.mjs";
import {
  buildRuntimeReport,
  collectRuntimeBudgetFailures,
  getSuiteRuntimeBaseline,
  reportRuntimeSummary,
  writeRuntimeReportIfRequested,
} from "./test-runtime-metadata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");

const coverageRootDir = mkdtempSync(join(tmpdir(), "pp-coverage-"));
const keepCoverageRoot = process.env.PP_KEEP_COVERAGE_ROOT === "1";
const MAX_COVERAGE_LCOV_RETRIES = 3;
let sharedBuiltWorkspaceSnapshotRoot = null;
let cleanedUp = false;
let keptCoverageRootNotified = false;
// Keep coverage-owned isolated suites serial until Bun's lcov writer is
// reliable across concurrent coverage processes. The Bun 1.3.13 audit via
// scripts/bench-coverage-concurrency.mjs still found non-equivalent lcov maps
// at concurrency >= 2 and nondeterministic hashes at concurrency 3/4.
// The default test runner still uses fixtureClass-aware concurrency for
// non-coverage execution.
const COVERAGE_ISOLATED_CONCURRENCY = 1;

class CoverageSuiteExitError extends Error {
  constructor(label, { status = null, signal = null } = {}) {
    super(
      signal
        ? `coverage suite ${label} exited via signal ${signal}`
        : `coverage suite ${label} exited with status ${status ?? "null"}`,
    );
    this.name = "CoverageSuiteExitError";
    this.label = label;
    this.status = status;
    this.signal = signal;
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
    return;
  }

  if (!keptCoverageRootNotified) {
    keptCoverageRootNotified = true;
    process.stdout.write(
      `coverage debug artifacts kept at ${coverageRootDir}\n`,
    );
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

async function runCoverageSuite(args, coverageDir, envOverrides = {}) {
  const child = spawn(
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
      stdio: ["ignore", "pipe", "pipe"],
      env: envOverrides,
    },
  );

  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
}

async function runCoverageSuiteWithFallback(suite, attempt = 1) {
  const { label, tests, budgetMs = null, tags = [] } = suite;
  const attemptLabel = attempt === 1 ? label : `${label}-retry-${attempt}`;
  const coverageDir = join(coverageRootDir, attemptLabel);
  const homeDir = join(coverageRootDir, `home-${attemptLabel}`);
  mkdirSync(homeDir, { recursive: true });
  const startedAt = Date.now();

  process.stdout.write(
    `[coverage] running ${attemptLabel}: ${tests.join(" ")}\n`,
  );

  const result = await runCoverageSuite(
    tests,
    coverageDir,
    buildCoverageSuiteEnv(tests, {
      PRIVACY_POOLS_HOME: homeDir,
    }),
  );
  const runtimeResult = {
    label: attemptLabel,
    canonicalLabel: label,
    durationMs: Date.now() - startedAt,
    budgetMs,
    baselineMs: getSuiteRuntimeBaseline(label),
    tags,
    tests,
    budgetExceeded:
      Number.isInteger(budgetMs) && Date.now() - startedAt > budgetMs,
  };
  const lcovPath = join(coverageDir, "lcov.info");
  const wroteLcov = existsSync(lcovPath);
  if (result.signal) {
    throw new CoverageSuiteExitError(label, { signal: result.signal });
  }
  if (result.status !== 0) {
    throw new CoverageSuiteExitError(label, { status: result.status ?? 1 });
  }
  if (wroteLcov) {
    return {
      coverageArtifacts: [lcovPath],
      runtimeResults: [runtimeResult],
    };
  }

  if (attempt < MAX_COVERAGE_LCOV_RETRIES) {
    process.stdout.write(
      `[coverage] ${label} emitted no lcov on attempt ${attempt}; retrying the same suite\n`,
    );
    return runCoverageSuiteWithFallback(suite, attempt + 1);
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

  const leftResult = await runCoverageSuiteWithFallback({
    ...suite,
    label: `${label}-a`,
    tests: left,
  });
  const rightResult = await runCoverageSuiteWithFallback({
    ...suite,
    label: `${label}-b`,
    tests: right,
  });

  return {
    coverageArtifacts: [
      ...leftResult.coverageArtifacts,
      ...rightResult.coverageArtifacts,
    ],
    runtimeResults: [
      runtimeResult,
      ...leftResult.runtimeResults,
      ...rightResult.runtimeResults,
    ],
  };
}

async function runCoverageSuitesWithConcurrency(suites, concurrency) {
  if (suites.length === 0) {
    return {
      coverageArtifacts: [],
      runtimeResults: [],
    };
  }

  const queue = [...suites];
  const active = new Map();
  const activeFixtureClasses = new Set();
  const coverageArtifacts = [];
  const runtimeResults = [];

  function takeNextSuite() {
    const nextIndex = queue.findIndex((suite) =>
      !suite.fixtureClass || !activeFixtureClasses.has(suite.fixtureClass)
    );
    if (nextIndex === -1) {
      return null;
    }

    return queue.splice(nextIndex, 1)[0] ?? null;
  }

  function startSuite(suite) {
    if (suite.fixtureClass) {
      activeFixtureClasses.add(suite.fixtureClass);
    }

    active.set(
      suite.label,
      runCoverageSuiteWithFallback(suite)
        .then((result) => ({ status: "fulfilled", suite, result }))
        .catch((error) => ({ status: "rejected", suite, error })),
    );
  }

  while (queue.length > 0 || active.size > 0) {
    while (active.size < Math.max(1, Math.min(concurrency, suites.length))) {
      const suite = takeNextSuite();
      if (!suite) break;
      startSuite(suite);
    }

    if (active.size === 0) {
      break;
    }

    const completed = await Promise.race(active.values());
    active.delete(completed.suite.label);
    if (completed.suite.fixtureClass) {
      activeFixtureClasses.delete(completed.suite.fixtureClass);
    }

    if (completed.status === "rejected") {
      throw completed.error;
    }

    coverageArtifacts.push(...completed.result.coverageArtifacts);
    runtimeResults.push(...completed.result.runtimeResults);
  }

  return { coverageArtifacts, runtimeResults };
}

try {
  const mainSuites = buildCoverageMainSuites({
    rootDir: ROOT,
    testTargets: COVERAGE_MAIN_TEST_TARGETS,
    commandSurfaceTests: COVERAGE_SIGNAL_TESTS,
    excludedTests: COVERAGE_MAIN_EXCLUDED_TESTS,
  });
  const coverageArtifacts = [];
  const runtimeResults = [];

  for (const suite of mainSuites) {
    const result = await runCoverageSuiteWithFallback(suite);
    coverageArtifacts.push(...result.coverageArtifacts);
    runtimeResults.push(...result.runtimeResults);
  }

  const isolatedResults = await runCoverageSuitesWithConcurrency(
    COVERAGE_ISOLATED_SUITES,
    COVERAGE_ISOLATED_CONCURRENCY,
  );
  coverageArtifacts.push(...isolatedResults.coverageArtifacts);
  runtimeResults.push(...isolatedResults.runtimeResults);

  reportRuntimeSummary("slowest coverage suite runtimes", runtimeResults);
  writeRuntimeReportIfRequested(
    buildRuntimeReport({
      kind: "coverage-suite",
      heading: "slowest coverage suite runtimes",
      results: runtimeResults,
    }),
  );
  const budgetFailures = collectRuntimeBudgetFailures(runtimeResults);
  if (budgetFailures.length > 0) {
    console.error("Coverage runtime budgets exceeded:");
    for (const failure of budgetFailures) {
      console.error(
        `- ${failure.label}: ${failure.durationMs}ms > ${failure.budgetMs}ms`,
      );
    }
    process.exitCode = 1;
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
    if (!keptCoverageRootNotified) {
      keptCoverageRootNotified = true;
      process.stdout.write(
        `coverage debug artifacts kept at ${coverageRootDir}\n`,
      );
    }
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

  process.stdout.write("risk coverage scorecard (feature bundles where applicable):\n");
  for (const row of collectCoverageScorecard(mergedCoverage, RISK_COVERAGE_SCORECARD, {
    excludedSources: EXCLUDED_SOURCES,
    rootDir: ROOT,
  })) {
    const suffix = row.belowTarget ? " below target" : "";
    const scope =
      row.measurement === "bundle" ? ` [${row.bundleSize}-file bundle]` : "";
    process.stdout.write(
      `- ${row.label}: ${row.percent.toFixed(2)}% (${row.hit}/${row.total}) target ${row.target}%${scope}${suffix}\n`,
    );
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
