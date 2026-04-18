/**
 * Transaction command offline-boundary integration tests.
 *
 * Tests deposit, withdraw, and ragequit command variants far enough to
 * prove their accepted machine-mode flag combinations reach the shared
 * pool-resolution boundary. These tests deliberately do NOT claim to
 * cover dry-run / unsigned success behavior; those paths have dedicated
 * tests elsewhere.
 *
 * True success-path tests (generating precommitments, building unsigned
 * tx payloads, submitting transactions) live in the Anvil suite, which
 * runs the CLI against a forked local chain without live funds:
 *   1. `PP_ANVIL_E2E=1 npm run test:e2e:anvil` for the full suite
 *   2. `PP_ANVIL_E2E=1 npm run test:e2e:anvil:smoke` for the required CI lane
 *
 * This file still matters because it pins the exact offline failure
 * contract for the default integration suite, while the Anvil lane
 * covers the happy path.
 */

import { describe, expect, test } from "bun:test";
import {
  createSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
};

// Helper: assert the command accepted the provided flags and failed closed at
// the symbol-resolution boundary when both ASP discovery and the user-defined
// RPC are unavailable.
function expectPoolResolutionFailure(
  result: { status: number | null; stderr: string },
  json: {
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    error?: { category: string; hint?: string; retryable?: boolean };
  },
): void {
  expect(json.success).toBe(false);
  expect(json.error).toBeDefined();
  expect(json.errorCode).toBe("RPC_POOL_RESOLUTION_FAILED");
  expect(json.errorMessage).toContain(
    'Built-in pool fallback also failed for "ETH" on sepolia.',
  );
  expect(json.error!.category).toBe("RPC");
  expect(json.error!.hint).toContain("RPC URL");
  expect(json.error!.retryable).toBe(true);
  expect(result.status).toBe(3);
  expect(result.stderr.trim()).toBe("");
}

// ── deposit pipeline ─────────────────────────────────────────────────────────

describe("deposit command pipeline", () => {
  test("deposit --dry-run --json fails at ASP pool resolution", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("deposit --unsigned --json fails at ASP pool resolution", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "ETH", "--unsigned", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("deposit --unsigned --unsigned-format tx is rejected as unknown option", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ success: boolean; errorMessage: string; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.errorMessage).toContain("unsigned-format");
  });

  test("deposit --unsigned-format is rejected as unknown option", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "ETH", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorMessage: string;
      error: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.errorMessage).toContain("unsigned-format");
  });
});

// ── withdraw pipeline ────────────────────────────────────────────────────────

describe("withdraw command pipeline", () => {
  const RECIPIENT = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";

  test("withdraw --dry-run --direct fails at ASP pool resolution", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "ETH", "--dry-run", "--direct",
        "--to", RECIPIENT, "--chain", "sepolia",
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("withdraw --unsigned --direct fails at ASP pool resolution", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "ETH", "--unsigned", "--direct",
        "--to", RECIPIENT, "--chain", "sepolia",
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("withdraw --dry-run without a positional asset returns INPUT error", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "--dry-run", "--direct",
        "--to", RECIPIENT, "--chain", "sepolia",
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ success: boolean; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("withdraw --dry-run --direct without --to returns INPUT error", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "ETH", "--dry-run", "--direct",
        "--chain", "sepolia",
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ success: boolean; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });
});

// ── ragequit pipeline ────────────────────────────────────────────────────────

describe("ragequit command pipeline", () => {
  test("ragequit --dry-run fails at ASP pool resolution", () => {
    const result = runCli(
      ["--json", "ragequit", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("ragequit --unsigned fails at ASP pool resolution", () => {
    const result = runCli(
      ["--json", "ragequit", "ETH", "--unsigned", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("ragequit --dry-run without a positional asset returns INPUT error", () => {
    const result = runCli(
      ["--json", "ragequit", "--dry-run", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ success: boolean; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });
});
