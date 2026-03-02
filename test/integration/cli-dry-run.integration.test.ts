import { describe, expect, test } from "bun:test";
import { runCli, createTempHome, initSeededHome, parseJsonOutput } from "../helpers/cli.ts";

const OFFLINE_POOL_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

describe("--dry-run flag acceptance", () => {
  test("deposit --dry-run without --json keeps human-readable errors", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(["deposit", "0.01", "--dry-run", "--chain", "sepolia"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_POOL_ENV,
    });

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Error [INPUT]");
    expect(result.stderr).toContain("No asset specified");
  });

  test("deposit --dry-run is accepted and progresses past input validation", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    // Must produce valid JSON — flag was parsed correctly
    const json = parseJsonOutput<{
      success: boolean;
      schemaVersion?: string;
      error?: { category: string };
    }>(result.stdout);
    expect(typeof json.success).toBe("boolean");
    // If it failed, the error must NOT be INPUT — proving the flag was accepted
    // and the command progressed to ASP/RPC pool resolution
    if (!json.success && json.error) {
      expect(json.error.category).not.toBe("INPUT");
    }
  });

  test("withdraw --dry-run is accepted and progresses past input validation", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      [
        "--json",
        "withdraw",
        "0.01",
        "--asset",
        "ETH",
        "--dry-run",
        "--direct",
        "--to",
        "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    const json = parseJsonOutput<{
      success: boolean;
      error?: { category: string };
    }>(result.stdout);
    expect(typeof json.success).toBe("boolean");
    if (!json.success && json.error) {
      expect(json.error.category).not.toBe("INPUT");
    }
  });

  test("ragequit --dry-run is accepted and progresses past input validation", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    const json = parseJsonOutput<{
      success: boolean;
      error?: { category: string };
    }>(result.stdout);
    expect(typeof json.success).toBe("boolean");
    if (!json.success && json.error) {
      expect(json.error.category).not.toBe("INPUT");
    }
  });

  test("deposit --dry-run --json produces valid JSON error envelope", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expect(result.stdout.trim()).not.toBe("");
    const parsed = parseJsonOutput<{
      success: boolean;
      schemaVersion: string;
      error?: { category: string };
    }>(result.stdout);
    expect(parsed.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof parsed.success).toBe("boolean");
    // Should fail at pool resolution, not at input parsing
    if (!parsed.success && parsed.error) {
      expect(parsed.error.category).not.toBe("INPUT");
    }
  });
});
