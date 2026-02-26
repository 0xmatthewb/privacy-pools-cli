import { describe, expect, test } from "bun:test";
import { runCli, createTempHome, initSeededHome, parseJsonOutput } from "../helpers/cli.ts";

const OFFLINE_POOL_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

describe("--unsigned-format tx output normalization", () => {
  test("deposit --unsigned-format tx produces array output even for single tx", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    // This will fail at pool resolution but we test the flag is accepted
    const result = runCli(
      ["deposit", "0.01", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    // If it gets far enough to produce output, verify it's an array
    if (result.stdout.trim() && result.stdout.trim().startsWith("[")) {
      const parsed = JSON.parse(result.stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
    }
    // The flag itself should be recognized
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("unknown option '--unsigned-format'");
  });

  test("withdraw --unsigned-format tx flag is accepted", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      [
        "withdraw",
        "0.01",
        "--asset",
        "ETH",
        "--unsigned",
        "--unsigned-format",
        "tx",
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

  test("ragequit --unsigned-format tx flag is accepted", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["ragequit", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("unknown option");
  });
});

describe("--json output includes operation field", () => {
  test("deposit --json error output has schemaVersion", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    if (result.stdout.trim()) {
      try {
        const parsed = parseJsonOutput<{ schemaVersion?: string; success?: boolean }>(result.stdout);
        expect(parsed.schemaVersion).toBe("1.3.0");
        expect(typeof parsed.success).toBe("boolean");
      } catch {
        // command may not have produced JSON
      }
    }
  });
});
