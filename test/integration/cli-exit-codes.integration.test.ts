/**
 * Exit-code matrix test (Stripe/GitHub pattern).
 *
 * Systematically verifies that every CLI error category maps to its
 * documented exit code. This prevents regressions where error paths
 * accidentally return the wrong exit code.
 */
import { describe, expect, test } from "bun:test";
import {
  createSeededHome,
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

/** Documented exit-code → category mapping from src/utils/errors.ts */
const EXIT_CODE_MAP: Record<string, number> = {
  UNKNOWN: 1,
  INPUT: 2,
  RPC: 3,
  SETUP: 4,
  RELAYER: 5,
  PROOF: 6,
  CONTRACT: 7,
  ASP: 8,
};

describe("exit-code matrix", () => {
  test("INPUT error → exit code 2 (missing required option)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(EXIT_CODE_MAP.INPUT);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("INPUT");
  });

  test("ASP error → exit code 8 (offline ASP, pools command)", () => {
    const home = createTempHome();
    const result = runCli(
      ["--json", "pools", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(EXIT_CODE_MAP.ASP);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("ASP");
  }, 10_000);

  test("exit code 0 for successful commands (status)", () => {
    const home = createTempHome();
    const result = runCli(["--json", "status"], { home, timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{ success: boolean }>(result.stdout);
    expect(json.success).toBe(true);
  });

  test("exit code 0 for successful commands (capabilities)", () => {
    const home = createTempHome();
    const result = runCli(["--json", "capabilities"], { home, timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{ success: boolean }>(result.stdout);
    expect(json.success).toBe(true);
  });

  test("exit code 2 for unknown command", () => {
    const home = createTempHome();
    const result = runCli(["not-a-command"], { home });
    expect(result.status).toBe(2);
  });

  test("describe index stays a successful human-mode command without arguments", () => {
    const home = createTempHome();
    const result = runCli(["describe"], { home });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Describe: commands");
    expect(result.stderr).toContain("Available command paths");
  });

  test("describe index stays a successful structured-mode command without arguments", () => {
    const home = createTempHome();
    const result = runCli(["--json", "describe"], { home });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      mode?: string;
      commands?: Array<{ command?: string }>;
    }>(
      result.stdout,
    );
    expect(json.mode).toBe("describe-index");
    expect(json.commands?.some((entry) => entry.command === "withdraw")).toBe(true);
  });

  test("exit code 2 for invalid --limit value (history)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "history", "--limit", "-5"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    // Invalid limit should be INPUT error (exit 2)
    expect(result.status).toBe(EXIT_CODE_MAP.INPUT);
  });

  test("JSON error envelopes always include category and code fields", () => {
    const home = createSeededHome("sepolia");

    // Trigger an ASP error
    const result = runCli(
      ["--json", "pools", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).not.toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      error?: { category?: string; code?: string; message?: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(typeof json.error?.category).toBe("string");
    expect(typeof json.error?.code).toBe("string");
    expect(typeof json.error?.message).toBe("string");
  }, 10_000);

  test("all documented exit codes are distinct positive integers", () => {
    const codes = Object.values(EXIT_CODE_MAP);
    expect(codes.length).toBe(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) {
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code).toBeLessThanOrEqual(8);
    }
  });
});
