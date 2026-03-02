import { describe, expect, test } from "bun:test";
import { runCli, createTempHome, initSeededHome, parseJsonOutput } from "../helpers/cli.ts";

const OFFLINE_POOL_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

describe("pools command", () => {
  test("pools --json without init returns valid JSON envelope", () => {
    const home = createTempHome();
    const result = runCli(["--json", "pools", "--chain", "sepolia"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_POOL_ENV,
    });
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).not.toBe("");

    const parsed = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error?: { category?: string };
    }>(result.stdout);
    expect(parsed.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.category).toBe("ASP");
    expect(result.status).toBe(4);
  });

  test("pools --json with init returns valid JSON error envelope (ASP offline)", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(["--json", "pools", "--chain", "sepolia"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_POOL_ENV,
    });
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = parseJsonOutput<{ success: boolean; error?: { category?: string } }>(result.stdout);
    expect(typeof parsed.success).toBe("boolean");
    // Offline ASP → error
    expect(parsed.success).toBe(false);
  });

  test("pools --help shows help text", () => {
    const home = createTempHome();
    const result = runCli(["pools", "--help"], { home });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("pools");
  });

  test("pools with explicit --chain targets single chain (after init)", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(["--json", "pools", "--chain", "sepolia"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_POOL_ENV,
    });
    expect(result.timedOut).toBe(false);
    // Should not fail with "missing chain" — explicit --chain targets sepolia
    expect(result.stdout.trim()).not.toBe("");
    const parsed = parseJsonOutput<{ success: boolean }>(result.stdout);
    expect(typeof parsed.success).toBe("boolean");
  });
});
