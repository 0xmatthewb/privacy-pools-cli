import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setupSharedAnvilFixture } from "./anvil-shared-fixture.mjs";
import { extractProcessTimeoutArg } from "./test-runner-args.mjs";
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
const preparedCliTarball = process.env.PP_INSTALL_CLI_TARBALL?.trim() || null;
const forwardedArgs = [];
let installedOnly = false;

for (const token of process.argv.slice(2)) {
  if (token === "--installed-only") {
    installedOnly = true;
    continue;
  }
  forwardedArgs.push(token);
}

const { processTimeoutMs } = extractProcessTimeoutArg(forwardedArgs, 900_000);

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
  result = installedOnly
    ? { status: 0, signal: null, error: undefined }
    : spawnSync(
        "node",
        [
          RUNNER,
          TEST_FILE,
          "--timeout",
          "600000",
          "--process-timeout-ms",
          String(processTimeoutMs),
          "--test-name-pattern",
          smokePattern,
        ],
        {
          stdio: "inherit",
          env: sharedEnv,
        },
      );

  if (!result.error && result.status === 0) {
    const verifyArgs = [VERIFY_INSTALLED_CLI];
    if (preparedCliTarball) {
      verifyArgs.push("--cli-tarball", preparedCliTarball);
    }
    installedArtifactResult = spawnSync(
      "node",
      verifyArgs,
      {
        stdio: "inherit",
        env: sharedEnv,
        timeout: processTimeoutMs,
      },
    );
  }
} finally {
  await sharedFixture.cleanup();
}

if (result.error) {
  const timedOut =
    typeof result.error.message === "string"
    && result.error.message.includes("ETIMEDOUT");
  if (timedOut) {
    process.stderr.write(
      `anvil smoke runner exceeded the outer process timeout (${processTimeoutMs}ms)\n`,
    );
    process.exit(1);
  }
  throw result.error;
}

if (typeof result.status === "number") {
  if (result.status === 0 && installedArtifactResult) {
    if (installedArtifactResult.error) {
      const timedOut =
        typeof installedArtifactResult.error.message === "string"
        && installedArtifactResult.error.message.includes("ETIMEDOUT");
      if (timedOut) {
        process.stderr.write(
          `installed anvil verification exceeded the outer process timeout (${processTimeoutMs}ms)\n`,
        );
        process.exit(1);
      }
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
