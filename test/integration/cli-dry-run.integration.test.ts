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

  test("deposit --dry-run is accepted as a flag", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    // Should not fail with "unknown option --dry-run"
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("unknown option");
    // It may fail with RPC/ASP errors but that's expected - the flag itself should be recognized
  });

  test("withdraw --dry-run is accepted as a flag", () => {
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
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("unknown option");
  });

  test("ragequit --dry-run is accepted as a flag", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("unknown option");
  });

  test("deposit --dry-run --json produces valid JSON error envelope", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    // Command will fail at pool resolution (offline ASP) but must produce valid JSON
    expect(result.stdout.trim()).not.toBe("");
    const parsed = parseJsonOutput<{ success: boolean; schemaVersion?: string }>(result.stdout);
    expect(typeof parsed).toBe("object");
    expect(typeof parsed.success).toBe("boolean");
  });
});
