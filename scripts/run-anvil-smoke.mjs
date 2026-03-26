import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
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

const sharedCircuitsDir = mkdtempSync(join(tmpdir(), "pp-anvil-smoke-circuits-"));

let result;
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
      env: {
        ...process.env,
        PP_ANVIL_E2E: "1",
        PP_ANVIL_SHARED_CIRCUITS_DIR: sharedCircuitsDir,
      },
    }
  );
} finally {
  rmSync(sharedCircuitsDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
