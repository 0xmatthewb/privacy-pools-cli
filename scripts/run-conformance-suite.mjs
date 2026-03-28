import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFORMANCE_DIR = resolve(ROOT, "test/conformance");
const RUNNER = resolve(ROOT, "scripts/run-bun-tests.mjs");
const FRONTEND_PARITY_MARKER = "@frontend-parity";

function listConformanceTests() {
  return readdirSync(CONFORMANCE_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
}

function isFrontendParityTest(name) {
  const source = readFileSync(resolve(CONFORMANCE_DIR, name), "utf8");
  return source.includes(FRONTEND_PARITY_MARKER);
}

function selectTests(mode) {
  const all = listConformanceTests();
  const frontend = all.filter((name) => isFrontendParityTest(name));
  const core = all.filter((name) => !isFrontendParityTest(name));

  switch (mode) {
    case "all":
      return all;
    case "core":
      if (core.length === 0) {
        throw new Error("Core conformance selection is empty.");
      }
      return core;
    case "frontend":
      if (frontend.length === 0) {
        throw new Error(
          `Frontend conformance selection is empty. Mark live parity tests with '${FRONTEND_PARITY_MARKER}'.`,
        );
      }
      return frontend;
    default:
      throw new Error(`Unknown conformance suite "${mode}". Use core, frontend, or all.`);
  }
}

function runSuite(testNames, env = process.env) {
  const selected = testNames.map((name) => resolve(CONFORMANCE_DIR, name));
  if (selected.length === 0) {
    throw new Error("Conformance suite selected no test files.");
  }

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

  const frontendStatus = runSuite(selectTests("frontend"));
  process.exit(frontendStatus);
}

if (mode === "frontend") {
  process.exit(runSuite(selectTests("frontend")));
}

process.exit(runSuite(selectTests("core")));
