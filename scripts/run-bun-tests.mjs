import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const runId = `${process.pid}-${Date.now()}`;
const tempPrefixes = [
  "pp-cli-test-",
  "pp-smoke-dist-",
  "pp-anvil-ragequit-",
  "pp-anvil-withdraw-",
  "pp-anvil-relayed-withdraw-",
  "pp-anvil-ragequit-alt-modes-",
  "pp-anvil-withdraw-alt-modes-",
  "pp-test-",
];

function cleanupRunTempDirs() {
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const matchesRun = tempPrefixes.some((prefix) => name.startsWith(`${prefix}${runId}-`));
    if (!matchesRun) continue;

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
  forwardedArgs.push(token);
}

// Bun's default 5s per-test timeout is too tight for our slower integration
// cases when the full suite is contending for CPU or network resources.
// Keep a higher default for reliability, while still allowing explicit
// --timeout values in package scripts or ad hoc runs to override it.
const hasExplicitTimeout = forwardedArgs.includes("--timeout");
if (!hasExplicitTimeout) {
  forwardedArgs.push("--timeout", "30000");
}

const bunArgs = excludedPaths.size === 0
  ? forwardedArgs
  : forwardedArgs.flatMap((token) => {
      if (token.startsWith("-") || !existsSync(token)) {
        return [token];
      }

      return collectTestFiles(token).filter((candidate) => {
        return !excludedPaths.has(resolve(candidate));
      });
    });

const hasExplicitTestTarget = bunArgs.some((token) => {
  return !token.startsWith("-") && existsSync(resolve(token));
});

if (!hasExplicitTestTarget) {
  throw new Error(
    "No test files selected. Pass at least one test file or directory.",
  );
}

const result = spawnSync("bun", ["test", ...bunArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    PP_TEST_RUN_ID: runId,
  },
});

cleanupRunTempDirs();

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
