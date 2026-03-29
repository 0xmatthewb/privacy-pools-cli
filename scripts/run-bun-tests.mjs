import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { shouldTreatBunExitAsSuccess } from "./bun-runner-exit.mjs";
import {
  expandPathArgsWithExcludes,
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
} from "./test-runner-args.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const runId = `${process.pid}-${Date.now()}`;
const TEMP_PREFIX = "pp-";
let cleanedUp = false;

function cleanupRunTempDirs() {
  if (cleanedUp) return;
  cleanedUp = true;

  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    if (!name.startsWith(TEMP_PREFIX) || !name.includes(`${runId}-`)) continue;

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

function exitWithCleanup(code) {
  cleanupRunTempDirs();
  process.exit(code);
}

process.once("beforeExit", cleanupRunTempDirs);
process.once("exit", cleanupRunTempDirs);
process.once("SIGINT", () => exitWithCleanup(130));
process.once("SIGTERM", () => exitWithCleanup(143));

function collectTestFiles(pathArg) {
  const absolute = resolve(pathArg);
  const stat = statSync(absolute);
  if (stat.isFile()) {
    return [pathArg];
  }

  const files = [];
  const queue = [absolute];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        files.push(relative(process.cwd(), entryPath));
      }
    }
  }

  return files.sort();
}

const forwardedArgs = [];
const excludedPaths = new Set();
let processTimeoutMs = 900_000;

for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (token === "--exclude") {
    const target = process.argv[i + 1];
    if (!target) {
      throw new Error("--exclude requires a path");
    }
    excludedPaths.add(resolve(target));
    i += 1;
    continue;
  }
  if (token === "--process-timeout-ms") {
    const rawValue = process.argv[i + 1];
    if (!rawValue) {
      throw new Error("--process-timeout-ms requires a value");
    }
    processTimeoutMs = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(processTimeoutMs) || processTimeoutMs <= 0) {
      throw new Error("--process-timeout-ms must be a positive integer");
    }
    i += 1;
    continue;
  }
  forwardedArgs.push(token);
}

// Bun's default 5s per-test timeout is too tight for our slower integration
// cases when the full suite is contending for CPU or network resources.
// Keep a higher default for reliability, while still allowing explicit
// --timeout values in package scripts or ad hoc runs to override it.
const hasExplicitTimeout = hasExplicitTimeoutArg(forwardedArgs);
if (!hasExplicitTimeout) {
  forwardedArgs.push("--timeout", "30000");
}

const bunArgs =
  excludedPaths.size === 0
    ? forwardedArgs
    : expandPathArgsWithExcludes(
        forwardedArgs,
        excludedPaths,
        collectTestFiles,
        process.cwd(),
      );

if (!hasExplicitTestTarget(bunArgs, process.cwd())) {
  throw new Error(
    "No test files selected. Pass at least one test file or directory.",
  );
}

let result;
try {
  result = spawnSync("bun", ["test", ...bunArgs], {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
    timeout: processTimeoutMs,
    maxBuffer: 50 * 1024 * 1024,
    env: buildTestRunnerEnv({
      PP_TEST_RUN_ID: runId,
    }),
  });
} finally {
  cleanupRunTempDirs();
}

if (typeof result.stdout === "string" && result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}

if (typeof result.stderr === "string" && result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}

if (result.error) {
  const timedOut =
    typeof result.error.message === "string"
    && result.error.message.includes("ETIMEDOUT");
  if (timedOut) {
    const targets = bunArgs.join(" ");
    process.stderr.write(
      `bun test exceeded the outer process timeout (${processTimeoutMs}ms): ${targets}\n`,
    );
    process.exit(1);
  }
  throw result.error;
}

if (typeof result.status === "number") {
  if (result.status === 0 || shouldTreatBunExitAsSuccess(result)) {
    process.exit(0);
  }
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
