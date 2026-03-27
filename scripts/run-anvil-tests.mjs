import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setupSharedAnvilFixture } from "./anvil-shared-fixture.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
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
const runnerEnv = buildTestRunnerEnv();
const sharedFixture = await setupSharedAnvilFixture({ baseEnv: runnerEnv });
let result;
try {
  result = spawnSync(
    "node",
    [
      RUNNER,
      ...TEST_FILES,
      "--timeout",
      "600000",
      ...extraArgs,
    ],
    {
      stdio: "inherit",
      env: buildTestRunnerEnv({
        PP_ANVIL_E2E: "1",
        PP_ANVIL_SHARED_CIRCUITS_DIR: sharedFixture.sharedCircuitsDir,
        PP_ANVIL_SHARED_ENV_FILE: sharedFixture.envFile,
      }, runnerEnv),
    }
  );
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
