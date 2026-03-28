import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setupSharedAnvilFixture } from "./anvil-shared-fixture.mjs";
import { collectTestFiles } from "./test-file-collector.mjs";
import {
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
  splitExplicitTargets,
} from "./test-runner-args.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const NODE_ONLY_TEST_FILES = new Set([
  resolve(ROOT, "test", "services", "workflow.anvil.service.test.ts"),
]);
const TEST_FILES = [
  resolve(ROOT, "test", "services", "workflow.anvil.service.test.ts"),
  resolve(ROOT, "test", "integration", "cli-anvil-e2e.integration.test.ts"),
  resolve(
    ROOT,
    "test",
    "integration",
    "cli-anvil-flow-new-wallet-erc20.integration.test.ts",
  ),
  resolve(
    ROOT,
    "test",
    "integration",
    "cli-anvil-flow-new-wallet-usdc.integration.test.ts",
  ),
];

const extraArgs = process.argv.slice(2);
const explicitTargets = hasExplicitTestTarget(extraArgs, ROOT)
  ? splitExplicitTargets(
      extraArgs,
      (pathArg) => collectTestFiles(pathArg, ROOT),
      ROOT,
    )
  : null;
const sharedArgs = explicitTargets?.sharedArgs ?? extraArgs;
const selectedTests = explicitTargets?.targetFiles ?? TEST_FILES;
const runnerEnv = buildTestRunnerEnv();
const sharedFixture = await setupSharedAnvilFixture({ baseEnv: runnerEnv });
let result = { status: 0, signal: null, error: undefined };

function translateNodeTestArgs(args) {
  const nodeArgs = ["--import", "tsx", "--test"];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--timeout") {
      const timeout = args[i + 1];
      if (!timeout) {
        throw new Error("--timeout requires a value");
      }
      nodeArgs.push(`--test-timeout=${timeout}`);
      i += 1;
      continue;
    }

    if (token === "-t" || token === "--test-name-pattern") {
      const pattern = args[i + 1];
      if (!pattern) {
        throw new Error(`${token} requires a value`);
      }
      nodeArgs.push(`--test-name-pattern=${pattern}`);
      i += 1;
      continue;
    }

    nodeArgs.push(token);
  }

  return nodeArgs;
}

try {
  const sharedEnv = buildTestRunnerEnv(
    {
      PP_ANVIL_E2E: "1",
      PP_ANVIL_SHARED_CIRCUITS_DIR: sharedFixture.sharedCircuitsDir,
      PP_ANVIL_SHARED_ENV_FILE: sharedFixture.envFile,
    },
    runnerEnv,
  );
  const baseArgs = hasExplicitTimeoutArg(sharedArgs)
    ? sharedArgs
    : ["--timeout", "600000", ...sharedArgs];

  for (const testFile of selectedTests) {
    process.stdout.write(`\n[anvil] ${testFile}\n`);
    result = NODE_ONLY_TEST_FILES.has(resolve(testFile))
      ? spawnSync(
          "node",
          [...translateNodeTestArgs(baseArgs), testFile],
          {
            stdio: "inherit",
            env: sharedEnv,
          },
        )
      : spawnSync(
          "node",
          [RUNNER, testFile, ...baseArgs],
          {
            stdio: "inherit",
            env: sharedEnv,
          },
        );

    if (result.error || result.status !== 0 || result.signal) {
      break;
    }
  }
} finally {
  await sharedFixture.cleanup();
}

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
