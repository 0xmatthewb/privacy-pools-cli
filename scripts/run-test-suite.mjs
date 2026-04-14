import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractTagArgs,
  groupTargetsByIsolation,
  hasExplicitProcessTimeoutArg,
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
  splitExplicitTargets,
} from "./test-runner-args.mjs";

import {
  DEFAULT_MAIN_BATCHES,
  DEFAULT_MAIN_EXCLUDED_TESTS,
  ON_DEMAND_TAG_SUITES,
  DEFAULT_TEST_ISOLATED_SUITES,
  suiteMatchesTags,
} from "./test-suite-manifest.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";
import { collectTestFiles } from "./test-file-collector.mjs";
import {
  buildDefaultMainSuites,
  resolveMainBatchConcurrency,
  resolveIsolatedSuiteConcurrency,
  suiteUsesSharedBuiltWorkspaceSnapshot,
} from "./main-suite-plan.mjs";
import {
  cleanupSharedBuiltWorkspaceSnapshot,
  createSharedBuiltWorkspaceSnapshot,
} from "./test-workspace-snapshot.mjs";
import {
  collectRuntimeBudgetFailures,
  reportRuntimeSummary,
} from "./test-runtime-metadata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const DEFAULT_BUN_PROCESS_TIMEOUT_MS = 900_000;
const forwardedArgs = process.argv.slice(2);
let sharedBuiltWorkspaceSnapshotRoot = null;
let sharedBuiltWorkspaceSnapshotPromise = null;
const activeSuiteChildren = new Set();
let cleanupStarted = false;
let cleanupPromise = null;

class SuiteRunnerExitError extends Error {
  constructor(label, { status = null, signal = null } = {}) {
    super(
      signal
        ? `suite ${label} exited via signal ${signal}`
        : `suite ${label} exited with status ${status ?? "null"}`,
    );
    this.name = "SuiteRunnerExitError";
    this.label = label;
    this.status = status;
    this.signal = signal;
  }
}

function buildRunnerArgs(args) {
  return hasExplicitProcessTimeoutArg(args)
    ? args
    : [...args, "--process-timeout-ms", String(DEFAULT_BUN_PROCESS_TIMEOUT_MS)];
}

async function ensureSharedBuiltWorkspaceSnapshotRoot() {
  if (sharedBuiltWorkspaceSnapshotRoot) {
    return sharedBuiltWorkspaceSnapshotRoot;
  }

  if (!sharedBuiltWorkspaceSnapshotPromise) {
    sharedBuiltWorkspaceSnapshotPromise = Promise.resolve().then(() => {
      const snapshotRoot = createSharedBuiltWorkspaceSnapshot(ROOT);
      sharedBuiltWorkspaceSnapshotRoot = snapshotRoot;
      return snapshotRoot;
    });
  }

  return sharedBuiltWorkspaceSnapshotPromise;
}

async function buildSuiteEnv(tests, overrides = {}) {
  const sharedBuiltWorkspaceSnapshot =
    suiteUsesSharedBuiltWorkspaceSnapshot(tests)
      ? {
          PP_TEST_BUILT_WORKSPACE_SNAPSHOT:
            await ensureSharedBuiltWorkspaceSnapshotRoot(),
        }
      : {};

  return buildTestRunnerEnv({
    ...sharedBuiltWorkspaceSnapshot,
    ...overrides,
  });
}

function prefixWrite(stream, prefix, chunk) {
  const text = chunk.toString();
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLastLine = index === lines.length - 1;
    if (line.length === 0 && isLastLine) {
      continue;
    }
    stream.write(`${prefix}${line}${isLastLine ? "" : "\n"}`);
  }
}

function buildSuiteInvocationArgs(suite, forwardedSuiteArgs) {
  const suiteArgs = [...suite.tests];
  if (
    Number.isInteger(suite.timeoutMs)
    && !hasExplicitTimeoutArg(forwardedSuiteArgs)
  ) {
    suiteArgs.push("--timeout", String(suite.timeoutMs));
  }

  return [...suiteArgs, ...forwardedSuiteArgs];
}

function suiteMetadataForPath(testPath) {
  const suites = [
    ...DEFAULT_TEST_ISOLATED_SUITES,
    ...ON_DEMAND_TAG_SUITES,
  ];

  const matchedSuite = suites.find((suite) => suite.tests.includes(testPath));
  if (matchedSuite) {
    return matchedSuite;
  }

  const matchedBatch = DEFAULT_MAIN_BATCHES.find((batch) =>
    batch.targets.some((target) => `${testPath}/`.startsWith(`${target}/`))
  );

  return matchedBatch ?? null;
}

function filterTargetFilesByTags(targetFiles, includeTags, excludeTags) {
  if (includeTags.length === 0 && excludeTags.length === 0) {
    return targetFiles;
  }

  return targetFiles.filter((targetFile) => {
    const suite = suiteMetadataForPath(targetFile);
    return suiteMatchesTags(
      suite ?? { tags: [] },
      includeTags,
      excludeTags,
    );
  });
}

async function runSuite(suite, args, envOverrides = {}) {
  const { label, tests, budgetMs = null, tags = [] } = suite;
  process.stdout.write(`\n[test] ${label}\n`);
  const startedAt = Date.now();

  const child = spawn("node", [RUNNER, ...buildRunnerArgs(args)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: await buildSuiteEnv(tests, envOverrides),
  });
  activeSuiteChildren.add(child);

  const cleanupChild = () => {
    activeSuiteChildren.delete(child);
  };

  child.stdout?.on("data", (chunk) => {
    prefixWrite(process.stdout, `[${label}] `, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    prefixWrite(process.stderr, `[${label}] `, chunk);
  });

  const result = await new Promise((resolve, reject) => {
    child.once("error", (error) => {
      cleanupChild();
      reject(error);
    });
    child.once("close", (status, signal) => {
      cleanupChild();
      resolve({ status, signal });
    });
  });

  if (result.signal) {
    throw new SuiteRunnerExitError(label, { signal: result.signal });
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new SuiteRunnerExitError(label, { status: result.status });
  }

  const durationMs = Date.now() - startedAt;
  return {
    label,
    durationMs,
    budgetMs,
    tags,
    budgetExceeded:
      Number.isInteger(budgetMs) && durationMs > budgetMs,
  };
}

async function terminateSuiteChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  let killTimer;
  await new Promise((resolve) => {
    const finish = () => {
      if (killTimer) clearTimeout(killTimer);
      resolve();
    };

    child.once("close", finish);
    child.kill("SIGTERM");

    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 1_000);
    killTimer.unref?.();
  });
}

async function terminateActiveSuiteChildren() {
  const children = [...activeSuiteChildren];
  await Promise.allSettled(children.map((child) => terminateSuiteChild(child)));
}

async function cleanupSuiteResources() {
  if (cleanupStarted) {
    return cleanupPromise;
  }

  cleanupStarted = true;
  cleanupPromise = (async () => {
    await terminateActiveSuiteChildren();
    cleanupSharedBuiltWorkspaceSnapshot(sharedBuiltWorkspaceSnapshotRoot);
  })();

  return cleanupPromise;
}

function exitWithCleanup(code) {
  void cleanupSuiteResources().finally(() => {
    process.exit(code);
  });
}

async function runSuitesWithConcurrency(
  suites,
  forwardedSuiteArgs,
  concurrency,
  { respectFixtureClass = false } = {},
) {
  if (suites.length === 0) return [];

  const queue = [...suites];
  const active = new Map();
  const activeFixtureClasses = new Set();
  const results = [];
  let suiteError = null;
  let terminating = null;

  async function requestStop() {
    if (!terminating) {
      queue.length = 0;
      terminating = terminateActiveSuiteChildren();
    }
    await terminating;
  }

  function takeNextSuite() {
    if (!respectFixtureClass) {
      return queue.shift() ?? null;
    }

    const nextIndex = queue.findIndex((suite) =>
      !suite.fixtureClass || !activeFixtureClasses.has(suite.fixtureClass)
    );
    if (nextIndex === -1) {
      return null;
    }

    return queue.splice(nextIndex, 1)[0] ?? null;
  }

  function startSuite(suite) {
    if (respectFixtureClass && suite.fixtureClass) {
      activeFixtureClasses.add(suite.fixtureClass);
    }

    const promise = runSuite(
      suite,
      buildSuiteInvocationArgs(suite, forwardedSuiteArgs),
    )
      .then((result) => ({ status: "fulfilled", suite, result }))
      .catch((error) => ({ status: "rejected", suite, error }));

    active.set(suite.label, promise);
  }

  while ((queue.length > 0 || active.size > 0) && !suiteError) {
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
    if (respectFixtureClass && completed.suite.fixtureClass) {
      activeFixtureClasses.delete(completed.suite.fixtureClass);
    }

    if (completed.status === "rejected") {
      suiteError = completed.error;
      await requestStop();
      break;
    }

    results.push(completed.result);
  }

  if (suiteError) {
    throw suiteError;
  }

  return results;
}

async function main() {
  try {
    const {
      args: suiteArgs,
      includeTags,
      excludeTags,
    } = extractTagArgs(forwardedArgs);

    if (suiteArgs.length > 0 && hasExplicitTestTarget(suiteArgs, ROOT)) {
      const { sharedArgs, targetFiles } = splitExplicitTargets(
        suiteArgs,
        (pathArg) => collectTestFiles(pathArg, ROOT),
        ROOT,
      );
      const filteredTargets = filterTargetFilesByTags(
        targetFiles,
        includeTags,
        excludeTags,
      );
      if (filteredTargets.length === 0) {
        throw new Error("No test suites selected by the current tag filters.");
      }
      const { mainTargets, isolatedGroups } = groupTargetsByIsolation(
        filteredTargets,
        [...DEFAULT_TEST_ISOLATED_SUITES, ...ON_DEMAND_TAG_SUITES],
        ROOT,
      );
      const runtimeResults = [];

      if (mainTargets.length > 0) {
        runtimeResults.push(
          ...await runSuitesWithConcurrency([
            {
              label: "custom",
              tests: mainTargets,
              tags: [],
              budgetMs: null,
            },
          ], sharedArgs, 1),
        );
      }

      if (isolatedGroups.length > 0) {
        runtimeResults.push(
          ...await runSuitesWithConcurrency(
            isolatedGroups.map((suite) => ({
              ...suite,
              label: `custom:${suite.label}`,
            })),
            sharedArgs,
            resolveIsolatedSuiteConcurrency({
              suiteCount: isolatedGroups.length,
            }),
            { respectFixtureClass: true },
          ),
        );
      }

      reportRuntimeSummary("slowest suite runtimes", runtimeResults);
      const budgetFailures = collectRuntimeBudgetFailures(runtimeResults);
      if (budgetFailures.length > 0) {
        process.stderr.write("Runtime budgets exceeded:\n");
        for (const failure of budgetFailures) {
          process.stderr.write(
            `- ${failure.label}: ${failure.durationMs}ms > ${failure.budgetMs}ms\n`,
          );
        }
        process.exitCode = 1;
      }
      return;
    }

    const mainSuites = buildDefaultMainSuites({
      rootDir: ROOT,
      testBatches: DEFAULT_MAIN_BATCHES,
      excludedTests: DEFAULT_MAIN_EXCLUDED_TESTS,
    }).filter((suite) => suiteMatchesTags(suite, includeTags, excludeTags));

    const onDemandSuites = includeTags.length === 0
      ? []
      : ON_DEMAND_TAG_SUITES.filter((suite) =>
        suiteMatchesTags(suite, includeTags, excludeTags)
      );

    const isolatedSuites = DEFAULT_TEST_ISOLATED_SUITES.filter((suite) =>
      suiteMatchesTags(suite, includeTags, excludeTags)
    );

    if (
      mainSuites.length === 0
      && onDemandSuites.length === 0
      && isolatedSuites.length === 0
    ) {
      throw new Error("No test suites selected by the current tag filters.");
    }

    const runtimeResults = [];

    runtimeResults.push(
      ...await runSuitesWithConcurrency(
      mainSuites,
      suiteArgs,
      resolveMainBatchConcurrency({ suiteCount: mainSuites.length }),
    ),
    );

    runtimeResults.push(
      ...await runSuitesWithConcurrency(
        isolatedSuites,
        suiteArgs,
        resolveIsolatedSuiteConcurrency({ suiteCount: isolatedSuites.length }),
        { respectFixtureClass: true },
      ),
    );

    runtimeResults.push(
      ...await runSuitesWithConcurrency(
        onDemandSuites,
        suiteArgs,
        resolveIsolatedSuiteConcurrency({ suiteCount: onDemandSuites.length }),
        { respectFixtureClass: true },
      ),
    );

    reportRuntimeSummary("slowest suite runtimes", runtimeResults);
    const budgetFailures = collectRuntimeBudgetFailures(runtimeResults);
    if (budgetFailures.length > 0) {
      process.stderr.write("Runtime budgets exceeded:\n");
      for (const failure of budgetFailures) {
        process.stderr.write(
          `- ${failure.label}: ${failure.durationMs}ms > ${failure.budgetMs}ms\n`,
        );
      }
      process.exitCode = 1;
    }
  } finally {
    await cleanupSuiteResources();
  }
}

process.once("SIGINT", () => exitWithCleanup(130));
process.once("SIGTERM", () => exitWithCleanup(143));

try {
  await main();
} catch (error) {
  if (error instanceof SuiteRunnerExitError) {
    if (error.signal) {
      process.kill(process.pid, error.signal);
    }
    process.exit(error.status ?? 1);
  }

  throw error;
}
