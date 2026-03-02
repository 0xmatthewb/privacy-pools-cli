/**
 * Transaction command pipeline integration tests.
 *
 * Tests deposit, withdraw, and ragequit commands as deep as possible
 * without a live chain.  With valid inputs and an offline ASP/RPC, each
 * command should progress through input parsing, amount validation, chain
 * selection, and flag handling — then fail at pool resolution (ASP or RPC
 * error, NOT INPUT).  This proves the entire input pipeline works.
 *
 * True success-path tests (generating precommitments, building unsigned
 * tx payloads, submitting transactions) require either:
 *   1. A funded E2E test (PP_E2E_ENABLED=1, skipped by default)
 *   2. An Anvil-forked local chain with deployed contracts
 *
 * Addresses audit finding 1: "Default integration suite does not exercise
 * protocol-critical success paths."
 */

import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

function seededHome(): string {
  const home = createTempHome();
  initSeededHome(home, "sepolia");
  return home;
}

// Helper: assert the command progressed past all input validation
function expectPastInputValidation(
  json: { success: boolean; error?: { category: string } },
): void {
  expect(typeof json.success).toBe("boolean");
  if (!json.success) {
    expect(json.error).toBeDefined();
    expect(json.error!.category).not.toBe("INPUT");
  }
}

// ── deposit pipeline ─────────────────────────────────────────────────────────

describe("deposit command pipeline", () => {
  test("deposit --dry-run --json with valid args progresses past input validation", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPastInputValidation(json);
  });

  test("deposit --unsigned --json with valid args progresses past input validation", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPastInputValidation(json);
  });

  test("deposit --unsigned --unsigned-format tx with valid args progresses past input validation", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPastInputValidation(json);
  });

  test("deposit --dry-run rejects zero amount", () => {
    const result = runCli(
      ["--json", "deposit", "0", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).not.toBe(0);
    const json = parseJsonOutput<{ success: boolean; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
  });

  test("deposit --unsigned-format without --unsigned returns INPUT error", () => {
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorMessage: string;
      error: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.errorMessage).toContain("--unsigned-format requires --unsigned");
  });
});

// ── withdraw pipeline ────────────────────────────────────────────────────────

describe("withdraw command pipeline", () => {
  const RECIPIENT = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";

  test("withdraw --dry-run --direct with valid args progresses past input validation", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "--asset", "ETH", "--dry-run", "--direct",
        "--to", RECIPIENT, "--chain", "sepolia",
      ],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPastInputValidation(json);
  });

  test("withdraw --unsigned --direct with valid args progresses past input validation", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "--asset", "ETH", "--unsigned", "--direct",
        "--to", RECIPIENT, "--chain", "sepolia",
      ],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPastInputValidation(json);
  });

  test("withdraw --dry-run without --asset returns INPUT error", () => {
    const result = runCli(
      [
        "--json", "withdraw", "0.01",
        "--dry-run", "--direct",
        "--to", RECIPIENT, "--chain", "sepolia",
      ],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
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
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ success: boolean; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });
});

// ── ragequit pipeline ────────────────────────────────────────────────────────

describe("ragequit command pipeline", () => {
  test("ragequit --dry-run with valid args progresses past input validation", () => {
    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPastInputValidation(json);
  });

  test("ragequit --unsigned with valid args progresses past input validation", () => {
    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--unsigned", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    const json = parseJsonOutput<{ success: boolean; error?: { category: string } }>(result.stdout);
    expectPastInputValidation(json);
  });

  test("ragequit --dry-run without --asset returns INPUT error", () => {
    const result = runCli(
      ["--json", "ragequit", "--dry-run", "--chain", "sepolia"],
      { home: seededHome(), timeoutMs: 10_000, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ success: boolean; error: { category: string } }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });
});
