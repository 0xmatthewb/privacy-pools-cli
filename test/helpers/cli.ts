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
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";
import { CLI_ROOT } from "./paths.ts";
import { buildChildProcessEnv } from "./child-env.ts";

export const CLI_CWD = CLI_ROOT;

export interface CliRunOptions {
  home?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  input?: string;
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

export interface TestSecretFiles {
  secretsDir: string;
  mnemonic: string;
  privateKey: string;
  mnemonicPath: string;
  privateKeyPath: string;
}

const trackedTempHomes = new Set<string>();
const retainedTempHomes = new Set<string>();
const seededHomeTemplates = new Map<string, string>();
const TEST_RUN_ID = process.env.PP_TEST_RUN_ID?.trim();

export const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
export const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

function cleanupTrackedTempHomes(includeRetained: boolean = false): void {
  const remainingTracked = new Set<string>();
  for (const dir of trackedTempHomes) {
    if (!includeRetained && retainedTempHomes.has(dir)) {
      remainingTracked.add(dir);
      continue;
    }
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
  for (const dir of remainingTracked) {
    trackedTempHomes.add(dir);
  }

  if (includeRetained) {
    retainedTempHomes.clear();
    seededHomeTemplates.clear();
  }
}

// Register cleanup during module evaluation so Bun sees the suite hook
// before tests begin executing. Lazy registration inside helpers is too late
// for ad hoc `bun test <file>` runs and can leak temp homes.
afterAll(() => cleanupTrackedTempHomes(false));
process.once("beforeExit", () => cleanupTrackedTempHomes(true));
process.once("exit", () => cleanupTrackedTempHomes(true));

export function createTempHome(prefix: string = "pp-cli-test-"): string {
  const effectivePrefix = TEST_RUN_ID ? `${prefix}${TEST_RUN_ID}-` : prefix;
  const home = mkdtempSync(join(tmpdir(), effectivePrefix));
  trackedTempHomes.add(home);
  return home;
}

export function createSeededHome(chain: string = "mainnet"): string {
  let template = seededHomeTemplates.get(chain);
  if (!template) {
    template = createTempHome(`pp-seeded-template-${chain}-`);
    mustInitSeededHome(template, chain);
    retainedTempHomes.add(template);
    seededHomeTemplates.set(chain, template);
  }

  const home = createTempHome(`pp-seeded-home-${chain}-`);
  cpSync(template, home, {
    recursive: true,
    force: true,
  });
  return home;
}

export function runCli(args: string[], options: CliRunOptions = {}): CliRunResult {
  const home = options.home ?? createTempHome();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const start = Date.now();

  const result = spawnSync("bun", ["src/index.ts", ...args], {
    cwd: CLI_CWD,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      ...options.env,
    }),
    encoding: "utf8",
    input: options.input,
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
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      ...options.env,
    }),
    encoding: "utf8",
    input: options.input,
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

interface BuildTestInitArgsOptions {
  chain?: string;
  mnemonic?: string;
  privateKey?: string;
  rpcUrl?: string;
  force?: boolean;
}

export function writeTestSecretFiles(
  home: string,
  opts: Pick<BuildTestInitArgsOptions, "mnemonic" | "privateKey"> = {},
): TestSecretFiles {
  const mnemonic = opts.mnemonic ?? TEST_MNEMONIC;
  const privateKey = opts.privateKey ?? TEST_PRIVATE_KEY;
  const secretsDir = join(home, ".test-secrets");
  mkdirSync(secretsDir, { recursive: true });

  const mnemonicPath = join(secretsDir, "mnemonic.txt");
  const privateKeyPath = join(secretsDir, "private-key.txt");
  writeFileSync(mnemonicPath, `${mnemonic}\n`, { encoding: "utf8", mode: 0o600 });
  writeFileSync(privateKeyPath, `${privateKey}\n`, { encoding: "utf8", mode: 0o600 });

  return {
    secretsDir,
    mnemonic,
    privateKey,
    mnemonicPath,
    privateKeyPath,
  };
}

export function buildTestInitArgs(
  home: string,
  opts: BuildTestInitArgsOptions = {},
): string[] {
  const chain = opts.chain ?? "mainnet";
  const { mnemonicPath, privateKeyPath } = writeTestSecretFiles(home, opts);

  const args = [
    "--json",
    "init",
    "--mnemonic-file",
    mnemonicPath,
    "--private-key-file",
    privateKeyPath,
    "--default-chain",
    chain,
  ];

  if (opts.rpcUrl) {
    args.push("--rpc-url", opts.rpcUrl);
  }
  if (opts.force) {
    args.push("--force");
  }

  args.push("--yes");
  return args;
}

export function initSeededHome(home: string, chain: string = "mainnet"): CliRunResult {
  return runCli(buildTestInitArgs(home, { chain }), {
    home,
    timeoutMs: 60_000,
  });
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
