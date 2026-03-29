import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");

const result = spawnSync(
  "node",
  [
    RUNNER,
    "./test/stress/cli.stress-120-rounds.stress.ts",
    "--timeout",
    "240000",
    "--process-timeout-ms",
    "900000",
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: buildTestRunnerEnv({
      PP_STRESS_ENABLED: "1",
    }),
  },
);

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
