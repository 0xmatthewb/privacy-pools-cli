import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groupTargetsByIsolation,
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
  splitExplicitTargets,
} from "./test-runner-args.mjs";

import {
  DEFAULT_MAIN_EXCLUDED_TESTS,
  DEFAULT_MAIN_TEST_TARGETS,
  DEFAULT_TEST_ISOLATED_SUITES,
} from "./test-suite-manifest.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";
import { collectTestFiles } from "./test-file-collector.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const forwardedArgs = process.argv.slice(2);

function runSuite(label, args) {
  process.stdout.write(`\n[test] ${label}\n`);

  const result = spawnSync("node", [RUNNER, ...args], {
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

const mainArgs = [...DEFAULT_MAIN_TEST_TARGETS];
for (const excluded of DEFAULT_MAIN_EXCLUDED_TESTS) {
  mainArgs.push("--exclude", excluded);
}
mainArgs.push(...forwardedArgs);

runSuite("main", mainArgs);

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
