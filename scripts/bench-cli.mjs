#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const repoNodeModules = join(repoRoot, "node_modules");
const repoNodeModulesBin = join(repoNodeModules, ".bin");
const fixtureServerScript = join(repoRoot, "test", "helpers", "fixture-server.ts");

const DEFAULT_BASE_REF = "origin/main";
const DEFAULT_RUNS = 10;
const DEFAULT_WARMUP = 1;
const DEFAULT_RUNTIME = "js";

const STRIPPED_ENV_PREFIXES = ["PRIVACY_POOLS_", "PP_"];

const COMMANDS = [
  {
    label: "--help",
    args: ["--help"],
  },
  {
    label: "--version",
    args: ["--version"],
  },
  {
    label: "capabilities --agent",
    args: ["capabilities", "--agent"],
  },
  {
    label: "describe withdraw quote --agent",
    args: ["describe", "withdraw", "quote", "--agent"],
  },
  {
    label: "flow --help",
    args: ["flow", "--help"],
  },
  {
    label: "migrate --help",
    args: ["migrate", "--help"],
  },
  {
    label: "status --json --no-check",
    args: ["status", "--json", "--no-check"],
    isolateHome: true,
  },
  {
    label: "pools --agent --chain sepolia",
    args: ["--chain", "sepolia", "pools", "--agent"],
    env: ({ fixtureUrl }) => ({
      PRIVACY_POOLS_ASP_HOST: fixtureUrl,
      PRIVACY_POOLS_RPC_URL_SEPOLIA: fixtureUrl,
    }),
  },
  {
    label: "activity --agent",
    args: ["activity", "--agent"],
    env: ({ fixtureUrl }) => ({
      PRIVACY_POOLS_ASP_HOST: fixtureUrl,
    }),
  },
  {
    label: "stats --agent",
    args: ["stats", "--agent"],
    env: ({ fixtureUrl }) => ({
      PRIVACY_POOLS_ASP_HOST: fixtureUrl,
    }),
  },
  {
    label: "stats pool --agent --chain sepolia --asset ETH",
    args: ["--chain", "sepolia", "stats", "pool", "--asset", "ETH", "--agent"],
    env: ({ fixtureUrl }) => ({
      PRIVACY_POOLS_ASP_HOST: fixtureUrl,
      PRIVACY_POOLS_RPC_URL_SEPOLIA: fixtureUrl,
    }),
  },
];

function sanitizedProcessEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (STRIPPED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}

function printUsageAndExit(exitCode = 0) {
  process.stdout.write(
    [
      "Usage: node scripts/bench-cli.mjs [--base <ref>] [--runs <n>] [--warmup <n>] [--runtime <js|native|both>]",
      "",
      "Compares the current checkout against a git ref by building both and timing",
      "a small read-only command matrix.",
      "Base timings always use the JS fallback path so native preview branches",
      "can be measured directly against the current npm baseline.",
      "",
      "Options:",
      `  --base <ref>    Git ref to compare against (default: ${DEFAULT_BASE_REF})`,
      `  --runs <n>      Timed runs per command (default: ${DEFAULT_RUNS})`,
      `  --warmup <n>    Warmup runs before timing (default: ${DEFAULT_WARMUP})`,
      `  --runtime <m>   Current checkout runtime: js, native, or both (default: ${DEFAULT_RUNTIME})`,
      "  --help          Show this message",
      "",
      "Examples:",
      "  node scripts/bench-cli.mjs",
      "  node scripts/bench-cli.mjs --base origin/main --runs 12",
      "  node scripts/bench-cli.mjs --runtime native",
      "  node scripts/bench-cli.mjs --runtime both --runs 6",
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
    runtime: DEFAULT_RUNTIME,
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
    if (token === "--runtime") {
      const value = argv[i + 1];
      if (!value) throw new Error("--runtime requires a value");
      options.runtime = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--runtime=")) {
      options.runtime = token.slice("--runtime=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!["js", "native", "both"].includes(options.runtime)) {
    throw new Error("--runtime must be one of: js, native, both");
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

function withRepoBinPath(
  env = {},
  { disableNative = true } = {},
) {
  return {
    ...sanitizedProcessEnv(),
    PATH: `${repoNodeModulesBin}:${process.env.PATH ?? ""}`,
    PP_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    ...(disableNative ? { PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1" } : {}),
    ...env,
  };
}

function launchFixtureServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", fixtureServerScript], {
      stdio: ["ignore", "pipe", "ignore"],
      env: withRepoBinPath(),
    });

    let output = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Fixture server did not start within 10s"));
    }, 10_000);

    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/FIXTURE_PORT=(\d+)/);
      if (!match) return;

      clearTimeout(timeout);
      resolve({
        proc,
        url: `http://127.0.0.1:${Number(match[1])}`,
      });
    });

    proc.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture server exited early with code ${code}`));
    });
  });
}

function stopFixtureServer(fixture) {
  return new Promise((resolve) => {
    if (!fixture) {
      resolve();
      return;
    }

    fixture.proc.once("exit", () => resolve());
    fixture.proc.kill();
  });
}

function buildCheckout(cwd) {
  spawnOrThrow("bun", ["run", "build"], {
    cwd,
    env: withRepoBinPath(),
  });
}

function nativeShellBinaryName(platform = process.platform) {
  return platform === "win32"
    ? "privacy-pools-cli-native-shell.exe"
    : "privacy-pools-cli-native-shell";
}

function assertNativeSupported() {
  const supported =
    (process.platform === "darwin" &&
      (process.arch === "arm64" || process.arch === "x64")) ||
    (process.platform === "linux" && process.arch === "x64") ||
    (process.platform === "win32" &&
      (process.arch === "arm64" || process.arch === "x64"));
  if (!supported) {
    throw new Error(
      `Native benchmarking is not supported on ${process.platform}/${process.arch}.`,
    );
  }
}

function buildNativeShell(cwd) {
  spawnOrThrow("cargo", ["build", "--manifest-path", "native/shell/Cargo.toml", "--release"], {
    cwd,
    env: withRepoBinPath({}, { disableNative: false }),
  });
}

function nativeShellBinaryPath(cwd) {
  return join(
    cwd,
    "native",
    "shell",
    "target",
    "release",
    nativeShellBinaryName(),
  );
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

    const fixture = await launchFixtureServer();
    try {
      const currentDist = join(repoRoot, "dist", "index.js");
      const baselineDist = join(baselineWorktree, "dist", "index.js");
      const currentBaseEnv = withRepoBinPath();
      const baselineBaseEnv = withRepoBinPath();
      const runtimes =
        commandArgs.runtime === "both" ? ["js", "native"] : [commandArgs.runtime];
      let currentNativeBinary = null;

      if (runtimes.includes("native")) {
        assertNativeSupported();
        buildNativeShell(repoRoot);
        currentNativeBinary = nativeShellBinaryPath(repoRoot);
      }

      process.stdout.write(
        [
          `CLI benchmark comparison`,
          `base ref: ${commandArgs.baseRef}`,
          `runs: ${commandArgs.runs}`,
          `warmup: ${commandArgs.warmup}`,
          `base runtime: js`,
          `current runtime: ${commandArgs.runtime}`,
          "",
          [
            "runtime",
            "command",
            "base median",
            "current median",
            "delta",
            "delta %",
          ].join("\t"),
        ].join("\n") + "\n",
      );

      for (const runtime of runtimes) {
        for (const command of COMMANDS) {
          const extraEnv =
            typeof command.env === "function"
              ? command.env({ fixtureUrl: fixture.url })
              : {};
          const currentEnv =
            runtime === "native"
              ? withRepoBinPath(
                  {
                    ...extraEnv,
                    PRIVACY_POOLS_CLI_BINARY: currentNativeBinary,
                  },
                  { disableNative: false },
                )
              : {
                  ...currentBaseEnv,
                  ...extraEnv,
                };
          const baseEnv = {
            ...baselineBaseEnv,
            ...extraEnv,
          };
          const tempHomes = [];

          if (command.isolateHome) {
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
                runtime,
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
      }
    } finally {
      await stopFixtureServer(fixture);
    }
  } finally {
    cleanupBaselineWorktree(baselineWorktree);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
