import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const result = spawnSync(
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
    env: {
      ...process.env,
      PP_ANVIL_E2E: "1",
    },
  }
);

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
