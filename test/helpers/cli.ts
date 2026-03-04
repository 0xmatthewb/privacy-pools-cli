/**
 * CLI integration test helpers.
 *
 * COVERAGE NOTE: Integration tests spawn the CLI as a child process via
 * spawnSync, so code-coverage tools only instrument the test harness —
 * not the CLI source executed in the subprocess.  Line-coverage numbers
 * from integration runs are therefore non-authoritative for command code.
 * Use unit tests (test/unit/) for source-level coverage; use these
 * integration tests for behavioral contracts (exit codes, JSON envelopes,
 * stream separation, flag acceptance).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";
import { CLI_ROOT } from "./paths.ts";

export const CLI_CWD = CLI_ROOT;

export interface CliRunOptions {
  home?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export interface CliRunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  timedOut: boolean;
  errorMessage?: string;
}

const trackedTempHomes = new Set<string>();
let cleanupHookRegistered = false;

function cleanupTrackedTempHomes(): void {
  for (const dir of trackedTempHomes) {
    try {
      rmSync(dir, {
        recursive: true,
        force: true,
        // Windows can transiently hold handles briefly after child exit.
        maxRetries: 3,
        retryDelay: 50,
      });
    } catch {
      // Best effort cleanup.
    }
  }
  trackedTempHomes.clear();
}

function ensureCleanupHook(): void {
  if (cleanupHookRegistered) return;
  cleanupHookRegistered = true;
  // Bun test runner lifecycle (reliable within test workers).
  afterAll(cleanupTrackedTempHomes);
  // Fallback for non-test invocations of this helper.
  process.once("beforeExit", cleanupTrackedTempHomes);
  process.once("exit", cleanupTrackedTempHomes);
}
ensureCleanupHook();

export function createTempHome(prefix: string = "pp-cli-test-"): string {
  const home = mkdtempSync(join(tmpdir(), prefix));
  trackedTempHomes.add(home);
  return home;
}

export function runCli(args: string[], options: CliRunOptions = {}): CliRunResult {
  const home = options.home ?? createTempHome();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const start = Date.now();

  const result = spawnSync("bun", ["src/index.ts", ...args], {
    cwd: CLI_CWD,
    env: {
      ...process.env,
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      ...options.env,
    },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const elapsedMs = Date.now() - start;
  const timedOut =
    result.status === null &&
    result.signal === "SIGTERM" &&
    typeof result.error?.message === "string" &&
    result.error.message.includes("ETIMEDOUT");

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    elapsedMs,
    timedOut,
    errorMessage: result.error?.message,
  };
}

export function runBuiltCli(
  args: string[],
  options: CliRunOptions = {}
): CliRunResult {
  const home = options.home ?? createTempHome();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const start = Date.now();

  const result = spawnSync("node", ["dist/index.js", ...args], {
    cwd: CLI_CWD,
    env: {
      ...process.env,
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      ...options.env,
    },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const elapsedMs = Date.now() - start;
  const timedOut =
    result.status === null &&
    result.signal === "SIGTERM" &&
    typeof result.error?.message === "string" &&
    result.error.message.includes("ETIMEDOUT");

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    elapsedMs,
    timedOut,
    errorMessage: result.error?.message,
  };
}

export function parseJsonOutput<T = unknown>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(
      `parseJsonOutput: stdout is empty — no JSON to parse.\n` +
      `  (received ${stdout.length} chars of whitespace-only output)`
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    const preview = trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
    throw new Error(
      `parseJsonOutput: failed to parse stdout as JSON.\n` +
      `  Parse error: ${err instanceof Error ? err.message : String(err)}\n` +
      `  stdout preview: ${preview}`
    );
  }
}

export function initSeededHome(home: string, chain: string = "mainnet"): CliRunResult {
  const mnemonic = "test test test test test test test test test test test junk";
  const privateKey = "0x1111111111111111111111111111111111111111111111111111111111111111";

  return runCli(
    [
      "--json",
      "init",
      "--mnemonic",
      mnemonic,
      "--private-key",
      privateKey,
      "--default-chain",
      chain,
      "--yes",
    ],
    { home, timeoutMs: 60_000 }
  );
}

/**
 * Like initSeededHome but throws if init exits non-zero.
 * Prevents tests from silently passing when setup fails.
 */
export function mustInitSeededHome(home: string, chain?: string): string {
  const result = initSeededHome(home, chain);
  if (result.status !== 0) {
    throw new Error(
      `mustInitSeededHome failed (exit ${result.status}):\n${result.stderr}`
    );
  }
  return home;
}
