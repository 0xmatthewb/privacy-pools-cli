import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";
import { QUARANTINED_SUITES } from "./test-suite-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  process.stdout.write(`\n[flake] ${command} ${args.join(" ")}\n`);

  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: buildTestRunnerEnv(),
    ...options,
  });

  if (result.error) {
    fail(
      `Failed to execute ${command} ${args.join(" ")}: ${result.error.message}`,
    );
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
}

function normalizeSeed(rawSeed) {
  const trimmed = rawSeed.trim();
  const parsed = Number(trimmed);
  if (
    Number.isInteger(parsed) &&
    parsed > 0 &&
    parsed <= 2_147_483_647
  ) {
    return { raw: trimmed, normalized: String(parsed) };
  }

  let state = 0;
  for (const char of trimmed) {
    state = (state * 33 + char.charCodeAt(0)) % 2_147_483_647;
  }

  return {
    raw: trimmed,
    normalized: String(state === 0 ? 1 : state),
  };
}

const seedSource = process.env.PP_FLAKE_SEED?.trim() || `${Date.now()}`;
const seed = normalizeSeed(seedSource);
process.stdout.write(
  seed.raw === seed.normalized
    ? `[flake] randomized seed ${seed.normalized}\n`
    : `[flake] randomized seed ${seed.normalized} (from ${seed.raw})\n`,
);

run("node", [
  "scripts/run-test-suite.mjs",
  "--randomize",
  "--seed",
  seed.normalized,
]);
if (QUARANTINED_SUITES.length > 0) {
  run("node", [
    "scripts/run-test-suite.mjs",
    "--tag",
    "quarantined",
  ]);
}
run("node", [
  "scripts/run-bun-tests.mjs",
  "./test/acceptance/withdraw-quote.acceptance.test.ts",
  "./test/unit/public-command-handlers.unit.test.ts",
  "./test/unit/status-command-handler.unit.test.ts",
  "--rerun-each",
  "3",
  "--timeout",
  "120000",
  "--process-timeout-ms",
  "600000",
]);
run(npmCommand, ["run", "test:packed-smoke"]);
run(npmCommand, ["run", "test:smoke:native:package"]);
run(npmCommand, ["run", "build"]);
run(npmCommand, ["run", "test:artifacts:host"]);
