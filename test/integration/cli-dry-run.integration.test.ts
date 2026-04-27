import { describe, expect, test } from "bun:test";
import { createSeededHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

const OFFLINE_POOL_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
};

describe("--dry-run flag acceptance", () => {
  function expectOfflinePoolUnknownAsset(
    result: { status: number | null; stdout: string; stderr: string },
  ) {
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");
    const json = parseJsonOutput<{
      success: boolean;
      errorCode?: string;
      errorMessage?: string;
      error?: { category: string; code?: string; hint?: string; retryable?: boolean };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_UNKNOWN_ASSET");
    expect(json.errorMessage).toContain('No pool found for asset "ETH" on sepolia.');
    expect(json.error?.category).toBe("INPUT");
    expect(json.error?.code).toBe("INPUT_UNKNOWN_ASSET");
    expect(json.error?.hint).toContain("ASP may be offline");
    expect(json.error?.retryable).toBe(false);
  }

  test("deposit --dry-run without --json keeps human-readable errors", () => {
    const home = createSeededHome("sepolia");
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

  test("deposit --dry-run is accepted and fails closed when ASP-backed pool discovery is offline", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--timeout", "1", "--json", "deposit", "0.01", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expectOfflinePoolUnknownAsset(result);
  });

  test("withdraw --dry-run is accepted and fails closed when ASP-backed pool discovery is offline", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      [
        "--json",
        "--timeout",
        "1",
        "withdraw",
        "0.01",
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
    expectOfflinePoolUnknownAsset(result);
  });

  test("ragequit --dry-run is accepted and fails closed when ASP-backed pool discovery is offline", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--timeout", "1", "--json", "ragequit", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expectOfflinePoolUnknownAsset(result);
  });

  test("deposit --dry-run --json produces valid JSON error envelope", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--timeout", "1", "--json", "deposit", "0.01", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    const parsed = parseJsonOutput<{ schemaVersion: string }>(result.stdout);
    expect(parsed.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expectOfflinePoolUnknownAsset(result);
  });
});
