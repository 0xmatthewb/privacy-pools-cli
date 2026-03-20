/**
 * Transaction command pipeline integration tests.
 *
 * Tests deposit, withdraw, and ragequit commands as deep as possible
 * without a live chain.  With valid inputs and an offline ASP, each
 * command should progress through input parsing, amount validation, chain
 * selection, and flag handling — then fail at pool resolution with
 * category "ASP" / exit 4.  This proves the entire input pipeline works
 * and pins the exact failure stage so behavioral drift is caught.
 *
 * True success-path tests (generating precommitments, building unsigned
 * tx payloads, submitting transactions) live in the Anvil suite, which
 * runs the CLI against a forked local chain without live funds:
 *   1. `PP_ANVIL_E2E=1 bun run test:e2e:anvil` for the full suite
 *   2. `PP_ANVIL_E2E=1 bun run test:e2e:anvil:smoke` for the required CI lane
 *
 * This file still matters because it pins the offline failure boundary for
 * the default integration suite, while the Anvil lane covers the happy path.
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

// Helper: assert the command progressed past all input validation and
// failed at pool resolution (ASP + RPC both unreachable), the expected offline stage.
function expectPoolResolutionFailure(
  result: { status: number | null },
  json: { success: boolean; error?: { category: string } },
): void {
  expect(json.success).toBe(false);
  expect(json.error).toBeDefined();
  // With KNOWN_POOLS fallback (F-02), the CLI tries ASP → KNOWN_POOLS → RPC.
  // Both ASP and RPC are blocked, so pool resolution fails with RPC error.
  expect(json.error!.category).toBe("RPC");
  expect(result.status).toBe(3);  // RPC = exit 3
}

// ── deposit pipeline ─────────────────────────────────────────────────────────

describe("deposit command pipeline", () => {
  test("deposit --dry-run --json fails at ASP pool resolution", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("deposit --unsigned --json fails at ASP pool resolution", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("deposit --unsigned --unsigned-format tx returns migration INPUT error", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ success: boolean; errorMessage: string; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.errorMessage).toContain("--unsigned-format has been replaced");
  });

  test("deposit --dry-run rejects zero amount", () => {
    const result = runCli(
      ["--json", "deposit", "0", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).not.toBe(0);
    const json = parseJsonOutput<{ success: boolean; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
  });

  test("deposit --unsigned-format returns migration INPUT error", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned-format", "tx", "--chain", "sepolia"],
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
    expect(json.errorMessage).toContain("--unsigned-format has been replaced");
  });
});

// ── withdraw pipeline ────────────────────────────────────────────────────────

describe("withdraw command pipeline", () => {
  const RECIPIENT = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";

  test("withdraw --dry-run --direct fails at ASP pool resolution", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "--asset", "ETH", "--dry-run", "--direct",
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
        "--asset", "ETH", "--unsigned", "--direct",
        "--to", RECIPIENT, "--chain", "sepolia",
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("withdraw --dry-run without --asset returns INPUT error", () => {
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
        "--asset", "ETH", "--dry-run", "--direct",
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
      ["--json", "ragequit", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("ragequit --unsigned fails at ASP pool resolution", () => {
    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--unsigned", "--chain", "sepolia"],
      { home: createSeededHome("sepolia"), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPoolResolutionFailure(result, json);
  });

  test("ragequit --dry-run without --asset returns INPUT error", () => {
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
