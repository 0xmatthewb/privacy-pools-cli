import { spawnSync } from "node:child_process";
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
import { buildDefaultMainSuites } from "./main-suite-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const DEFAULT_BUN_PROCESS_TIMEOUT_MS = 900_000;
const forwardedArgs = process.argv.slice(2);

function runSuite(label, args) {
  process.stdout.write(`\n[test] ${label}\n`);

  const runnerArgs = hasExplicitProcessTimeoutArg(args)
    ? args
    : [...args, "--process-timeout-ms", String(DEFAULT_BUN_PROCESS_TIMEOUT_MS)];

  const result = spawnSync("node", [RUNNER, ...runnerArgs], {
    cwd: ROOT,
    stdio: "inherit",
    env: buildTestRunnerEnv(),
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
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
    runSuite("custom", [...mainTargets, ...sharedArgs]);
  }

  for (const suite of isolatedGroups) {
    const suiteArgs = [...suite.tests];
    if (!hasExplicitTimeoutArg(sharedArgs)) {
      suiteArgs.push("--timeout", String(suite.timeoutMs));
    }
    suiteArgs.push(...sharedArgs);
    runSuite(`custom:${suite.label}`, suiteArgs);
  }
  process.exit(0);
}

const mainSuites = buildDefaultMainSuites({
  rootDir: ROOT,
  testBatches: DEFAULT_MAIN_BATCHES,
  excludedTests: DEFAULT_MAIN_EXCLUDED_TESTS,
});

for (const suite of mainSuites) {
  runSuite(suite.label, [...suite.tests, ...forwardedArgs]);
}

for (const suite of DEFAULT_TEST_ISOLATED_SUITES) {
  const suiteArgs = [...suite.tests];
  if (!hasExplicitTimeoutArg(forwardedArgs)) {
    suiteArgs.push("--timeout", String(suite.timeoutMs));
  }
  suiteArgs.push(...forwardedArgs);
  runSuite(suite.label, [
    ...suiteArgs,
  ]);
}
