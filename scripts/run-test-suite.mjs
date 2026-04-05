import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groupTargetsByIsolation,
  hasExplicitProcessTimeoutArg,
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
  splitExplicitTargets,
} from "./test-runner-args.mjs";

import {
  DEFAULT_MAIN_BATCHES,
  DEFAULT_MAIN_EXCLUDED_TESTS,
  DEFAULT_TEST_ISOLATED_SUITES,
} from "./test-suite-manifest.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";
import { collectTestFiles } from "./test-file-collector.mjs";
import {
  buildDefaultMainSuites,
  resolveMainBatchConcurrency,
  suiteUsesSharedBuiltWorkspaceSnapshot,
} from "./main-suite-plan.mjs";
import {
  cleanupSharedBuiltWorkspaceSnapshot,
  createSharedBuiltWorkspaceSnapshot,
} from "./test-workspace-snapshot.mjs";

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

async function runSuite(label, tests, args, envOverrides = {}) {
  process.stdout.write(`\n[test] ${label}\n`);

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

async function runSuitesWithConcurrency(suites, forwardedSuiteArgs, concurrency) {
  if (suites.length === 0) return;

  const queue = [...suites];
  let suiteError = null;
  let terminating = null;

  async function requestStop() {
    if (!terminating) {
      queue.length = 0;
      terminating = terminateActiveSuiteChildren();
    }
    await terminating;
  }

  const workers = Array.from({
    length: Math.max(1, Math.min(concurrency, suites.length)),
  }, async () => {
    while (queue.length > 0) {
      if (suiteError) return;
      const suite = queue.shift();
      if (!suite) return;
      try {
        await runSuite(
          suite.label,
          suite.tests,
          [...suite.tests, ...forwardedSuiteArgs],
        );
      } catch (error) {
        suiteError ??= error;
        await requestStop();
        return;
      }
    }
  });

  await Promise.allSettled(workers);
  if (suiteError) {
    throw suiteError;
  }
}

async function main() {
  try {
    if (forwardedArgs.length > 0 && hasExplicitTestTarget(forwardedArgs, ROOT)) {
      const { sharedArgs, targetFiles } = splitExplicitTargets(
        forwardedArgs,
        (pathArg) => collectTestFiles(pathArg, ROOT),
        ROOT,
      );
      const { mainTargets, isolatedGroups } = groupTargetsByIsolation(
        targetFiles,
        DEFAULT_TEST_ISOLATED_SUITES,
        ROOT,
      );

      if (mainTargets.length > 0) {
        await runSuite("custom", mainTargets, [...mainTargets, ...sharedArgs]);
      }

      for (const suite of isolatedGroups) {
        const suiteArgs = [...suite.tests];
        if (!hasExplicitTimeoutArg(sharedArgs)) {
          suiteArgs.push("--timeout", String(suite.timeoutMs));
        }
        suiteArgs.push(...sharedArgs);
        await runSuite(`custom:${suite.label}`, suite.tests, suiteArgs);
      }
      return;
    }

    const mainSuites = buildDefaultMainSuites({
      rootDir: ROOT,
      testBatches: DEFAULT_MAIN_BATCHES,
      excludedTests: DEFAULT_MAIN_EXCLUDED_TESTS,
    });

    await runSuitesWithConcurrency(
      mainSuites,
      forwardedArgs,
      resolveMainBatchConcurrency({ suiteCount: mainSuites.length }),
    );

      for (const suite of DEFAULT_TEST_ISOLATED_SUITES) {
        const suiteArgs = [...suite.tests];
        if (!hasExplicitTimeoutArg(forwardedArgs)) {
          suiteArgs.push("--timeout", String(suite.timeoutMs));
        }
        suiteArgs.push(...forwardedArgs);
        await runSuite(suite.label, suite.tests, [
          ...suiteArgs,
        ]);
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
