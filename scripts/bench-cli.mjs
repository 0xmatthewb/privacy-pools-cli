#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const repoNodeModules = join(repoRoot, "node_modules");
const repoNodeModulesBin = join(repoNodeModules, ".bin");

const DEFAULT_BASE_REF = "origin/main";
const DEFAULT_RUNS = 10;
const DEFAULT_WARMUP = 1;

const COMMANDS = [
  {
    label: "--help",
    args: ["--help"],
    env: {},
  },
  {
    label: "--version",
    args: ["--version"],
    env: {},
  },
  {
    label: "status --json --no-check",
    args: ["status", "--json", "--no-check"],
    env: {
      PRIVACY_POOLS_HOME: "", // filled per-run with an isolated temp home
    },
  },
  {
    label: "capabilities --agent",
    args: ["capabilities", "--agent"],
    env: {},
  },
];

function printUsageAndExit(exitCode = 0) {
  process.stdout.write(
    [
      "Usage: node scripts/bench-cli.mjs [--base <ref>] [--runs <n>] [--warmup <n>]",
      "",
      "Compares the current checkout against a git ref by building both and timing",
      "a small read-only command matrix.",
      "",
      "Options:",
      `  --base <ref>    Git ref to compare against (default: ${DEFAULT_BASE_REF})`,
      `  --runs <n>      Timed runs per command (default: ${DEFAULT_RUNS})`,
      `  --warmup <n>    Warmup runs before timing (default: ${DEFAULT_WARMUP})`,
      "  --help          Show this message",
      "",
      "Examples:",
      "  node scripts/bench-cli.mjs",
      "  node scripts/bench-cli.mjs --base origin/main --runs 12",
    ].join("\n") + "\n",
  );
  process.exit(exitCode);
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    baseRef: DEFAULT_BASE_REF,
    runs: DEFAULT_RUNS,
    warmup: DEFAULT_WARMUP,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      printUsageAndExit(0);
    }
    if (token === "--base") {
      const value = argv[i + 1];
      if (!value) throw new Error("--base requires a git ref");
      options.baseRef = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--base=")) {
      options.baseRef = token.slice("--base=".length);
      continue;
    }
    if (token === "--runs") {
      const value = argv[i + 1];
      if (!value) throw new Error("--runs requires a value");
      options.runs = parseInteger(value, "--runs");
      i += 1;
      continue;
    }
    if (token.startsWith("--runs=")) {
      options.runs = parseInteger(token.slice("--runs=".length), "--runs");
      continue;
    }
    if (token === "--warmup") {
      const value = argv[i + 1];
      if (!value) throw new Error("--warmup requires a value");
      options.warmup = parseInteger(value, "--warmup");
      i += 1;
      continue;
    }
    if (token.startsWith("--warmup=")) {
      options.warmup = parseInteger(token.slice("--warmup=".length), "--warmup");
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function ensureNodeModules() {
  if (!existsSync(repoNodeModules)) {
    throw new Error(
      "node_modules not found. Run `bun install --frozen-lockfile` first.",
    );
  }
}

function spawnOrThrow(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...opts,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || result.stdout?.trim() || "";
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${stderr}`,
    );
  }
  return result;
}

function withRepoBinPath(env = {}) {
  return {
    ...process.env,
    PATH: `${repoNodeModulesBin}:${process.env.PATH ?? ""}`,
    PP_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    ...env,
  };
}

function buildCheckout(cwd) {
  spawnOrThrow("bun", ["run", "build"], {
    cwd,
    env: withRepoBinPath(),
  });
}

function createBaselineWorktree(baseRef) {
  const worktreeDir = mkdtempSync(join(tmpdir(), "pp-cli-bench-"));
  spawnOrThrow("git", ["worktree", "add", "--detach", worktreeDir, baseRef], {
    cwd: repoRoot,
    env: process.env,
  });

  const linkedNodeModules = join(worktreeDir, "node_modules");
  symlinkSync(repoNodeModules, linkedNodeModules, "dir");
  return worktreeDir;
}

function cleanupBaselineWorktree(worktreeDir) {
  try {
    spawnOrThrow("git", ["worktree", "remove", "--force", worktreeDir], {
      cwd: repoRoot,
      env: process.env,
    });
  } catch {
    // Best effort cleanup only.
  }

  try {
    rmSync(worktreeDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function hrtimeMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function runBench(commandPath, cwd, args, env, warmupRuns, timedRuns) {
  const timings = [];

  for (let i = 0; i < warmupRuns; i += 1) {
    spawnOrThrow(process.execPath, [commandPath, ...args], {
      cwd,
      env,
    });
  }

  for (let i = 0; i < timedRuns; i += 1) {
    const start = process.hrtime.bigint();
    const result = spawnSync(process.execPath, [commandPath, ...args], {
      cwd,
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
    const elapsedMs = hrtimeMs(start);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `Benchmark command failed: ${args.join(" ")}\n${result.stderr?.trim() || result.stdout?.trim() || ""}`,
      );
    }
    timings.push(elapsedMs);
  }

  return {
    mean: mean(timings),
    median: median(timings),
    min: Math.min(...timings),
    max: Math.max(...timings),
  };
}

const commandArgs = parseArgs(process.argv.slice(2));

try {
  ensureNodeModules();

  buildCheckout(repoRoot);

  const baselineWorktree = createBaselineWorktree(commandArgs.baseRef);
  try {
    buildCheckout(baselineWorktree);

    const currentDist = join(repoRoot, "dist", "index.js");
    const baselineDist = join(baselineWorktree, "dist", "index.js");
    const currentBaseEnv = withRepoBinPath();
    const baselineBaseEnv = withRepoBinPath();

    process.stdout.write(
      [
        `CLI benchmark comparison`,
        `base ref: ${commandArgs.baseRef}`,
        `runs: ${commandArgs.runs}`,
        `warmup: ${commandArgs.warmup}`,
        "",
        [
          "command",
          "base median",
          "current median",
          "delta",
          "delta %",
        ].join("\t"),
      ].join("\n") + "\n",
    );

    for (const command of COMMANDS) {
      const currentEnv = {
        ...currentBaseEnv,
        ...command.env,
      };
      const baseEnv = {
        ...baselineBaseEnv,
        ...command.env,
      };
      const tempHomes = [];

      if (command.label === "status --json --no-check") {
        const currentHome = mkdtempSync(join(tmpdir(), "pp-cli-bench-home-"));
        const baseHome = mkdtempSync(join(tmpdir(), "pp-cli-bench-home-"));
        currentEnv.PRIVACY_POOLS_HOME = currentHome;
        baseEnv.PRIVACY_POOLS_HOME = baseHome;
        tempHomes.push(currentHome, baseHome);
      }

      try {
        const base = runBench(
          baselineDist,
          baselineWorktree,
          command.args,
          baseEnv,
          commandArgs.warmup,
          commandArgs.runs,
        );
        const current = runBench(
          currentDist,
          repoRoot,
          command.args,
          currentEnv,
          commandArgs.warmup,
          commandArgs.runs,
        );
        const delta = current.median - base.median;
        const deltaPct = (delta / base.median) * 100;

        process.stdout.write(
          [
            command.label,
            formatMs(base.median),
            formatMs(current.median),
            `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} ms`,
            `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`,
          ].join("\t") + "\n",
        );
      } finally {
        for (const tempHome of tempHomes) {
          rmSync(tempHome, { recursive: true, force: true });
        }
      }
    }
  } finally {
    cleanupBaselineWorktree(baselineWorktree);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
