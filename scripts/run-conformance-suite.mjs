import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFORMANCE_DIR = resolve(ROOT, "test/conformance");
const RUNNER = resolve(ROOT, "scripts/run-bun-tests.mjs");
const FRONTEND_PARITY_TESTS = new Set([
  "chain-config.conformance.test.ts",
  "protocol-docs.contracts-sdk.conformance.test.ts",
]);

function listConformanceTests() {
  return readdirSync(CONFORMANCE_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
}

function selectTests(mode) {
  const all = listConformanceTests();

  switch (mode) {
    case "all":
      return all;
    case "core":
      return all.filter((name) => !FRONTEND_PARITY_TESTS.has(name));
    case "frontend":
      return all.filter((name) => FRONTEND_PARITY_TESTS.has(name));
    default:
      throw new Error(`Unknown conformance suite "${mode}". Use core, frontend, or all.`);
  }
}

const mode = process.argv[2] || "core";
const selected = selectTests(mode).map((name) => resolve(CONFORMANCE_DIR, name));

const result = spawnSync("node", [RUNNER, ...selected, "--timeout", "120000"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
