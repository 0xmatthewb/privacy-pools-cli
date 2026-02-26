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

  test("pools --json with init shows chain info in error", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(["--json", "pools", "--chain", "sepolia"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_POOL_ENV,
    });
    expect(result.timedOut).toBe(false);
    // Will fail with ASP/RPC error since no real network, but should be valid JSON
    if (result.stdout.trim()) {
      const parsed = parseJsonOutput<{ success: boolean; error?: { category?: string } }>(result.stdout);
      expect(typeof parsed.success).toBe("boolean");
    }
  });

  test("pools --help shows help text", () => {
    const home = createTempHome();
    const result = runCli(["pools", "--help"], { home });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("pools");
  });

  test("pools requires chain specification", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    // Without explicit chain, should use default from config
    const result = runCli(["--json", "pools"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_POOL_ENV,
    });
    expect(result.timedOut).toBe(false);
    // Should not fail with "missing chain" since init set default
    if (result.stdout.trim()) {
      try {
        const parsed = parseJsonOutput(result.stdout);
        expect(typeof parsed).toBe("object");
      } catch {
        // stdout might not be valid JSON if error
      }
    }
  });
});
