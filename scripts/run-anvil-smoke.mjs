import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setupSharedAnvilFixture } from "./anvil-shared-fixture.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const VERIFY_INSTALLED_CLI = resolve(
  ROOT,
  "scripts",
  "verify-cli-install-anvil.mjs",
);
const TEST_FILE = resolve(
  ROOT,
  "test",
  "integration",
  "cli-anvil-e2e.integration.test.ts",
);

const smokePattern = [
  "deposit -> sync -> accounts -> ragequit -> sync",
  "deposit -> approve -> withdraw \\(relayed\\) -> sync",
  "flow start -> approved watch -> completed",
].join("|");

const runnerEnv = buildTestRunnerEnv();
const sharedFixture = await setupSharedAnvilFixture({ baseEnv: runnerEnv });
const sharedEnv = buildTestRunnerEnv({
  PP_ANVIL_E2E: "1",
  PP_ANVIL_SHARED_CIRCUITS_DIR: sharedFixture.sharedCircuitsDir,
  PP_ANVIL_SHARED_ENV_FILE: sharedFixture.envFile,
}, runnerEnv);

let result;
let installedArtifactResult;
try {
  result = spawnSync(
    "node",
    [
      RUNNER,
      TEST_FILE,
      "--timeout",
      "600000",
      "--test-name-pattern",
      smokePattern,
    ],
    {
      stdio: "inherit",
      env: sharedEnv,
    }
  );

  if (!result.error && result.status === 0) {
    installedArtifactResult = spawnSync(
      "node",
      [VERIFY_INSTALLED_CLI],
      {
        stdio: "inherit",
        env: sharedEnv,
      },
    );
  }
} finally {
  await sharedFixture.cleanup();
}

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  if (result.status === 0 && installedArtifactResult) {
    if (installedArtifactResult.error) {
      throw installedArtifactResult.error;
    }

    if (typeof installedArtifactResult.status === "number") {
      process.exit(installedArtifactResult.status);
    }

    process.kill(process.pid, installedArtifactResult.signal ?? "SIGTERM");
  }

  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
