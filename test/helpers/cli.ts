import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CLI_CWD = "/workspace/privacy-pools-cli";

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

export function createTempHome(prefix: string = "pp-cli-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function runCli(args: string[], options: CliRunOptions = {}): CliRunResult {
  const home = options.home ?? createTempHome();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const start = Date.now();

  const result = spawnSync("bun", ["src/index.ts", ...args], {
    cwd: CLI_CWD,
    env: {
      ...process.env,
      HOME: home,
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
  return JSON.parse(stdout.trim()) as T;
}

export function initSeededHome(home: string, chain: string = "ethereum"): CliRunResult {
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
      "--skip-circuits",
      "--yes",
    ],
    { home, timeoutMs: 60_000 }
  );
}
