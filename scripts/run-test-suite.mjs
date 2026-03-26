import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAIN_EXCLUDED_TESTS,
  DEFAULT_MAIN_TEST_TARGETS,
  DEFAULT_TEST_ISOLATED_SUITES,
} from "./test-suite-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const forwardedArgs = process.argv.slice(2);

function runSuite(label, args) {
  process.stdout.write(`\n[test] ${label}\n`);

  const result = spawnSync("node", [RUNNER, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
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

function hasExplicitTestTarget(args) {
  return args.some((token) => {
    return !token.startsWith("-") && existsSync(resolve(ROOT, token));
  });
}

function hasExplicitTimeout(args) {
  return args.includes("--timeout");
}

if (forwardedArgs.length > 0 && hasExplicitTestTarget(forwardedArgs)) {
  runSuite("custom", forwardedArgs);
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
  if (!hasExplicitTimeout(forwardedArgs)) {
    suiteArgs.push("--timeout", String(suite.timeoutMs));
  }
  suiteArgs.push(...forwardedArgs);
  runSuite(suite.label, [
    ...suiteArgs,
  ]);
}
