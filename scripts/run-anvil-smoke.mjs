import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-anvil-tests.mjs");

const smokePattern = [
  "deposit -> sync -> accounts -> ragequit -> sync",
  "deposit -> approve -> accounts -> withdraw --direct -> sync",
  "deposit -> approve -> withdraw \\(relayed\\) -> sync",
].join("|");

const result = spawnSync(
  "node",
  [
    RUNNER,
    "--test-name-pattern",
    smokePattern,
  ],
  {
    stdio: "inherit",
    env: process.env,
  }
);

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
