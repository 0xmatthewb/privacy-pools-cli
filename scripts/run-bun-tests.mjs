import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runId = `${process.pid}-${Date.now()}`;
const tempPrefixes = [
  "pp-cli-test-",
  "pp-smoke-dist-",
  "pp-anvil-ragequit-",
  "pp-anvil-withdraw-",
  "pp-anvil-relayed-withdraw-",
  "pp-anvil-ragequit-alt-modes-",
  "pp-anvil-withdraw-alt-modes-",
  "pp-test-",
];

function cleanupRunTempDirs() {
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const matchesRun = tempPrefixes.some((prefix) => name.startsWith(`${prefix}${runId}-`));
    if (!matchesRun) continue;

    try {
      rmSync(join(tmpdir(), name), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    } catch {
      // Best effort cleanup only.
    }
  }
}

const result = spawnSync("bun", ["test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PP_TEST_RUN_ID: runId,
  },
});

cleanupRunTempDirs();

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
