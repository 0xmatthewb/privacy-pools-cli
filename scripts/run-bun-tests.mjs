import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  expandPathArgsWithExcludes,
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
} from "./test-runner-args.mjs";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const runId = `${process.pid}-${Date.now()}`;
const TEMP_PREFIX = "pp-";
const OUTPUT_TAIL_LIMIT_BYTES = 512 * 1024;
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

function appendTail(buffer, chunk) {
  const next = `${buffer}${chunk}`;
  if (Buffer.byteLength(next, "utf8") <= OUTPUT_TAIL_LIMIT_BYTES) {
    return next;
  }

  return Buffer.from(next, "utf8")
    .subarray(-OUTPUT_TAIL_LIMIT_BYTES)
    .toString("utf8");
}

async function runBunProcess(args, timeoutMs) {
  let timedOut = false;
  let stdoutTail = "";
  let stderrTail = "";

  const child = spawn("bun", ["test", ...args], {
    stdio: ["inherit", "pipe", "pipe"],
    env: buildTestRunnerEnv({
      PP_TEST_RUN_ID: runId,
      // Force a deterministic terminal width for renderers that branch on
      // getOutputWidthClass(). Setting COLUMNS in the spawned env bypasses
      // any uncertainty about whether the bunfig preload-guard fires (it
      // depends on cwd and bunfig.toml resolution, both of which can vary
      // between CI invocations: linux-core shard via test-shards.mjs vs
      // coverage-guard via check-coverage.mjs).
      COLUMNS: "120",
    }),
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
    stdoutTail = appendTail(stdoutTail, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
    stderrTail = appendTail(stderrTail, chunk);
  });

  let killTimer;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 1000);
    killTimer.unref?.();
  }, timeoutMs);
  timeoutHandle.unref?.();

  const result = await new Promise((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });

    child.once("close", (status, signal) => {
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        status,
        signal,
        stdout: stdoutTail,
        stderr: stderrTail,
        timedOut,
      });
    });
  });

  return result;
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
  result = await runBunProcess(bunArgs, processTimeoutMs);
} finally {
  cleanupRunTempDirs();
}

if (result.timedOut) {
  const targets = bunArgs.join(" ");
  process.stderr.write(
    `bun test exceeded the outer process timeout (${processTimeoutMs}ms): ${targets}\n`,
  );
  process.exit(1);
}

if (typeof result.status === "number") {
  if (result.status === 0) {
    process.exit(0);
  }
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
