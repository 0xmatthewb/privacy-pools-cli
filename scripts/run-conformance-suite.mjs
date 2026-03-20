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

function runSuite(testNames, env = process.env) {
  const selected = testNames.map((name) => resolve(CONFORMANCE_DIR, name));

  const result = spawnSync("node", [RUNNER, ...selected, "--timeout", "120000"], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number") {
    return result.status;
  }

  process.kill(process.pid, result.signal ?? "SIGTERM");
}

const mode = process.argv[2] || "core";

if (mode === "all") {
  const coreStatus = runSuite(selectTests("core"));
  if (coreStatus !== 0) {
    process.exit(coreStatus);
  }

  const frontendStatus = runSuite(selectTests("frontend"), {
    ...process.env,
    CONFORMANCE_FETCH_LIVE: "1",
  });
  process.exit(frontendStatus);
}

if (mode === "frontend") {
  process.exit(runSuite(selectTests("frontend"), {
    ...process.env,
    CONFORMANCE_FETCH_LIVE: "1",
  }));
}

process.exit(runSuite(selectTests("core")));
