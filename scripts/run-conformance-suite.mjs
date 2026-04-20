import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFORMANCE_DIR = resolve(ROOT, "test/conformance");
const RUNNER = resolve(ROOT, "scripts/run-bun-tests.mjs");
const FRONTEND_PARITY_MARKER = "@frontend-parity";
const ONLINE_MARKER = "@online";

function listConformanceTests() {
  return readdirSync(CONFORMANCE_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
}

function isFrontendParityTest(name) {
  const source = readFileSync(resolve(CONFORMANCE_DIR, name), "utf8");
  return source.includes(FRONTEND_PARITY_MARKER);
}

function hasMarker(name, marker) {
  const source = readFileSync(resolve(CONFORMANCE_DIR, name), "utf8");
  return source.includes(marker);
}

function parseExcludeTags(args) {
  const excludeTags = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--exclude-tag") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("--exclude-tag requires a value");
      }
      excludeTags.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (token?.startsWith("--exclude-tag=")) {
      excludeTags.push(
        ...token
          .slice("--exclude-tag=".length)
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      );
    }
  }

  return excludeTags;
}

function applyExcludeTags(testNames, excludeTags) {
  if (!excludeTags.includes("online")) {
    return testNames;
  }
  return testNames.filter((name) => !hasMarker(name, ONLINE_MARKER));
}

function selectTests(mode, excludeTags = []) {
  const all = listConformanceTests();
  const frontend = all.filter((name) => isFrontendParityTest(name));
  const core = all.filter((name) => !isFrontendParityTest(name));

  switch (mode) {
    case "all":
      return applyExcludeTags(all, excludeTags);
    case "core":
      if (core.length === 0) {
        throw new Error("Core conformance selection is empty.");
      }
      return applyExcludeTags(core, excludeTags);
    case "frontend":
      if (frontend.length === 0) {
        throw new Error(
          `Frontend conformance selection is empty. Mark live parity tests with '${FRONTEND_PARITY_MARKER}'.`,
        );
      }
      return applyExcludeTags(frontend, excludeTags);
    default:
      throw new Error(`Unknown conformance suite "${mode}". Use core, frontend, or all.`);
  }
}

function runSuite(testNames, env = process.env) {
  const selected = testNames.map((name) => resolve(CONFORMANCE_DIR, name));
  if (selected.length === 0) {
    throw new Error("Conformance suite selected no test files.");
  }

  const result = spawnSync(
    "node",
    [
      RUNNER,
      ...selected,
      "--timeout",
      "120000",
      "--process-timeout-ms",
      "900000",
    ],
    {
      stdio: "inherit",
      env,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number") {
    return result.status;
  }

  process.kill(process.pid, result.signal ?? "SIGTERM");
}

const rawArgs = process.argv.slice(2);
const mode = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "core";
const excludeTags = parseExcludeTags(rawArgs);

if (mode === "all") {
  const coreStatus = runSuite(selectTests("core", excludeTags));
  if (coreStatus !== 0) {
    process.exit(coreStatus);
  }

  const frontendStatus = runSuite(selectTests("frontend", excludeTags));
  process.exit(frontendStatus);
}

if (mode === "frontend") {
  process.exit(runSuite(selectTests("frontend", excludeTags)));
}

process.exit(runSuite(selectTests("core", excludeTags)));
