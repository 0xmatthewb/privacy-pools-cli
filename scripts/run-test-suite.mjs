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

function buildRunnerArgs(args) {
  return hasExplicitProcessTimeoutArg(args)
    ? args
    : [...args, "--process-timeout-ms", String(DEFAULT_BUN_PROCESS_TIMEOUT_MS)];
}

function buildSuiteEnv(overrides = {}) {
  const sharedBuiltWorkspaceSnapshot =
    sharedBuiltWorkspaceSnapshotRoot
      ? { PP_TEST_BUILT_WORKSPACE_SNAPSHOT: sharedBuiltWorkspaceSnapshotRoot }
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

async function runSuite(label, args, envOverrides = {}) {
  process.stdout.write(`\n[test] ${label}\n`);

  const child = spawn("node", [RUNNER, ...buildRunnerArgs(args)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: buildSuiteEnv(envOverrides),
  });

  child.stdout?.on("data", (chunk) => {
    prefixWrite(process.stdout, `[${label}] `, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    prefixWrite(process.stderr, `[${label}] `, chunk);
  });

  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => {
      resolve({ status, signal });
    });
  });

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

async function runSuitesWithConcurrency(suites, forwardedSuiteArgs, concurrency) {
  if (suites.length === 0) return;

  const queue = [...suites];
  const workers = Array.from({
    length: Math.max(1, Math.min(concurrency, suites.length)),
  }, async () => {
    while (queue.length > 0) {
      const suite = queue.shift();
      if (!suite) return;
      await runSuite(suite.label, [...suite.tests, ...forwardedSuiteArgs]);
    }
  });

  await Promise.all(workers);
}

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
    await runSuite("custom", [...mainTargets, ...sharedArgs]);
  }

  for (const suite of isolatedGroups) {
    const suiteArgs = [...suite.tests];
    if (!hasExplicitTimeoutArg(sharedArgs)) {
      suiteArgs.push("--timeout", String(suite.timeoutMs));
    }
    suiteArgs.push(...sharedArgs);
    await runSuite(`custom:${suite.label}`, suiteArgs);
  }
  process.exit(0);
}

const mainSuites = buildDefaultMainSuites({
  rootDir: ROOT,
  testBatches: DEFAULT_MAIN_BATCHES,
  excludedTests: DEFAULT_MAIN_EXCLUDED_TESTS,
});

if (mainSuites.length > 0) {
  sharedBuiltWorkspaceSnapshotRoot = createSharedBuiltWorkspaceSnapshot(ROOT);
}

try {
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
    await runSuite(suite.label, [
      ...suiteArgs,
    ]);
  }
} finally {
  cleanupSharedBuiltWorkspaceSnapshot(sharedBuiltWorkspaceSnapshotRoot);
}
