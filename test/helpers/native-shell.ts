import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { CliRunOptions, CliRunResult } from "./cli.ts";
import {
  CLI_CWD,
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "./cli.ts";
import { buildChildProcessEnv } from "./child-env.ts";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import { NATIVE_JS_BRIDGE_ENV } from "../../src/runtime/current.ts";
import { CURRENT_RUNTIME_DESCRIPTOR } from "../../src/runtime/runtime-contract.js";
import {
  CARGO_AVAILABLE,
  ensureNativeShellBinary,
} from "./native.ts";

export { ensureNativeShellBinary, CARGO_AVAILABLE };
export { runBuiltCli };

export const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
export const nativeTest = CARGO_AVAILABLE ? test : test.skip;
export const DEFAULT_PARITY_COMMAND_TIMEOUT_MS = 20_000;
export const PARITY_TEST_TIMEOUT_BUFFER_MS = 10_000;

const NODE_NO_COLOR_WARNING_PATTERN =
  /\(node:\d+\) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set\.\r?\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n?/g;
const DOTENV_TIP_PATTERN =
  /^\[dotenv@[^\]]+\] injecting env .*$/gm;

export interface ForwardingParityCase {
  label: string;
  args: string[];
  envFactory?: (fixture: { url: string }) => Record<string, string>;
  timeoutMs?: number;
  testTimeoutMs?: number;
}

export function runNativeBuiltCli(
  nativeBinary: string,
  args: string[],
  options: CliRunOptions = {},
): CliRunResult {
  return runBuiltCli(args, {
    ...options,
    env: {
      ...options.env,
      PRIVACY_POOLS_CLI_BINARY: nativeBinary,
    },
  });
}

export function runNativeBinaryDirect(
  nativeBinary: string,
  args: string[],
  options: CliRunOptions = {},
): CliRunResult {
  const home = options.home ?? createTempHome("pp-native-direct-");
  const timeoutMs = options.timeoutMs ?? DEFAULT_PARITY_COMMAND_TIMEOUT_MS;
  const cwd = options.cwd ?? CLI_CWD;
  const start = Date.now();
  const result = spawnSync(nativeBinary, args, {
    cwd,
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

export function withJsFallback(options: CliRunOptions = {}): CliRunOptions {
  return {
    ...options,
    env: {
      ...options.env,
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
  };
}

export function assertDidNotTimeout(
  label: string,
  result: CliRunResult,
): void {
  if (result.timedOut) {
    throw new Error(
      `${label} timed out after ${result.elapsedMs}ms.\n` +
      `stdout:\n${result.stdout}\n` +
      `stderr:\n${result.stderr}\n` +
      `error: ${result.errorMessage ?? "<none>"}`,
    );
  }
}

export function normalizeParityStderr(stderr: string): string {
  return stderr
    .replace(NODE_NO_COLOR_WARNING_PATTERN, "")
    .replace(DOTENV_TIP_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function normalizeParityJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeParityJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (key === "runtime" && (entry === "js" || entry === "native")) {
          return [key, "<RUNTIME>"];
        }
        if (key === "nextPollAfter") {
          return [key, typeof entry === "string" ? "<next-poll-after>" : entry];
        }
        return [key, normalizeParityJsonValue(entry)];
      }),
    );
  }

  return value;
}

export function resolveParityTestTimeout(
  timeoutMs?: number,
  testTimeoutMs?: number,
): number {
  const commandTimeoutMs = timeoutMs ?? DEFAULT_PARITY_COMMAND_TIMEOUT_MS;
  const minimumParityTimeoutMs =
    commandTimeoutMs * 2 + PARITY_TEST_TIMEOUT_BUFFER_MS;
  return Math.max(testTimeoutMs ?? 0, minimumParityTimeoutMs);
}

export function expectContractParity(
  nativeBinary: string,
  args: string[],
  contract: (result: CliRunResult) => void,
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  assertDidNotTimeout("JS launcher result", jsResult);
  assertDidNotTimeout("Native launcher result", nativeResult);
  expect(nativeResult.status).toBe(jsResult.status);
  contract(jsResult);
  contract(nativeResult);
}

export function expectStreamParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  assertDidNotTimeout("JS launcher result", jsResult);
  assertDidNotTimeout("Native launcher result", nativeResult);
  expect(nativeResult.status).toBe(jsResult.status);
  expect(nativeResult.stdout).toBe(jsResult.stdout);
  expect(normalizeParityStderr(nativeResult.stderr)).toBe(
    normalizeParityStderr(jsResult.stderr),
  );
}

export function expectJsonParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  assertDidNotTimeout("JS launcher result", jsResult);
  assertDidNotTimeout("Native launcher result", nativeResult);
  expect(nativeResult.status).toBe(jsResult.status);
  expect(normalizeParityJsonValue(parseJsonOutput(nativeResult.stdout))).toEqual(
    normalizeParityJsonValue(parseJsonOutput(jsResult.stdout)),
  );
  expect(normalizeParityStderr(nativeResult.stderr)).toBe(
    normalizeParityStderr(jsResult.stderr),
  );
}

export function expectSilentStreamParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  assertDidNotTimeout("JS launcher result", jsResult);
  assertDidNotTimeout("Native launcher result", nativeResult);
  expect(nativeResult.status).toBe(jsResult.status);
  expect(nativeResult.stdout.trim()).toBe("");
  expect(nativeResult.stderr.trim()).toBe("");
  expect(nativeResult.stdout).toBe(jsResult.stdout);
  expect(normalizeParityStderr(nativeResult.stderr)).toBe(
    normalizeParityStderr(jsResult.stderr),
  );
}

export function expectMachineSilenceParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  assertDidNotTimeout("JS launcher result", jsResult);
  assertDidNotTimeout("Native launcher result", nativeResult);
  expect(nativeResult.status).toBe(jsResult.status);
  expect(jsResult.stderr.trim()).toBe("");
  expect(nativeResult.stderr.trim()).toBe("");
  expect(normalizeParityJsonValue(parseJsonOutput(nativeResult.stdout))).toEqual(
    normalizeParityJsonValue(parseJsonOutput(jsResult.stdout)),
  );
}

export function expectDirectNativeBuiltJsonParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
  const nativeResult = runNativeBinaryDirect(nativeBinary, args, options.native);

  assertDidNotTimeout("JS launcher result", jsResult);
  assertDidNotTimeout("Direct native result", nativeResult);
  expect(nativeResult.status).toBe(jsResult.status);
  expect(normalizeParityJsonValue(parseJsonOutput(nativeResult.stdout))).toEqual(
    normalizeParityJsonValue(parseJsonOutput(jsResult.stdout)),
  );
  expect(normalizeParityStderr(nativeResult.stderr)).toBe(
    normalizeParityStderr(jsResult.stderr),
  );
}

export function expectJsonErrorContract(
  result: CliRunResult,
  options: {
    status: number | null;
    errorCode: string;
    category: string;
    message: string;
  },
): void {
  assertDidNotTimeout("CLI result", result);
  expect(result.status).toBe(options.status);
  const payload = parseJsonOutput<{
    success: boolean;
    errorCode: string;
    error: { category: string; code: string; message: string };
  }>(result.stdout);
  expect(payload.success).toBe(false);
  expect(payload.errorCode).toBe(options.errorCode);
  expect(payload.error.category).toBe(options.category);
  expect(payload.error.code).toBe(options.errorCode);
  expect(payload.error.message).toContain(options.message);
}

export function fixtureEnv(fixture: { url: string }): Record<string, string> {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
  };
}

export function emptyPoolsFixtureEnv(
  fixture: { url: string },
): Record<string, string> {
  return {
    ...fixtureEnv(fixture),
    PRIVACY_POOLS_ASP_HOST: `${fixture.url}/empty-pools`,
  };
}

export function multiChainFixtureEnv(
  fixture: { url: string },
): Record<string, string> {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_ETHEREUM: fixture.url,
    PRIVACY_POOLS_RPC_URL_MAINNET: fixture.url,
    PRIVACY_POOLS_RPC_URL_ARBITRUM: fixture.url,
    PRIVACY_POOLS_RPC_URL_OPTIMISM: fixture.url,
  };
}

export function seedSavedWorkflow(home: string): void {
  const workflowsDir = join(home, ".privacy-pools", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(
    join(workflowsDir, "wf-latest.json"),
    JSON.stringify(
      {
        schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
        workflowId: "wf-latest",
        createdAt: "2026-03-27T12:00:00.000Z",
        updatedAt: "2026-03-27T12:00:00.000Z",
        phase: "awaiting_asp",
        chain: "sepolia",
        asset: "ETH",
        depositAmount: "100000000000000000",
        recipient: TEST_RECIPIENT,
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        depositTxHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        depositBlockNumber: "12345",
        depositExplorerUrl: "https://example.test/tx/0xaaaaaaaa",
        committedValue: "99500000000000000",
        aspStatus: "pending",
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function buildIncompatibleBridgeEnv(params: {
  runtimeVersion?: string;
  nativeBridgeVersion?: string;
}) {
  return {
    [NATIVE_JS_BRIDGE_ENV]: Buffer.from(
      JSON.stringify({
        runtimeVersion:
          params.runtimeVersion ?? CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
        workerProtocolVersion:
          CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
        nativeBridgeVersion:
          params.nativeBridgeVersion
          ?? CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
        workerRequestEnv: CURRENT_RUNTIME_DESCRIPTOR.workerRequestEnv,
        workerCommand: process.execPath,
        workerArgs: [],
      }),
      "utf8",
    ).toString("base64"),
  };
}
