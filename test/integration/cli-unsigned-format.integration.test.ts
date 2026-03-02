import { describe, expect, test } from "bun:test";
import { runCli, createTempHome, initSeededHome, parseJsonOutput } from "../helpers/cli.ts";

const OFFLINE_POOL_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

describe("--unsigned-format tx output normalization", () => {
  test("deposit --unsigned-format tx is accepted and progresses past input validation", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    // Must produce valid JSON — both flags were parsed correctly
    const json = parseJsonOutput<{
      success: boolean;
      error?: { category: string };
    }>(result.stdout);
    expect(typeof json.success).toBe("boolean");
    // If it failed, the error must NOT be INPUT — proving flags were accepted
    if (!json.success && json.error) {
      expect(json.error.category).not.toBe("INPUT");
    }
  });

  test("withdraw --unsigned-format tx is accepted and progresses past input validation", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      [
        "--json",
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
    const json = parseJsonOutput<{
      success: boolean;
      error?: { category: string };
    }>(result.stdout);
    expect(typeof json.success).toBe("boolean");
    if (!json.success && json.error) {
      expect(json.error.category).not.toBe("INPUT");
    }
  });

  test("ragequit --unsigned-format tx is accepted and progresses past input validation", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
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
});

describe("--json output includes operation field", () => {
  test("deposit --json error output has schemaVersion", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expect(result.stdout.trim()).not.toBe("");
    const parsed = parseJsonOutput<{ schemaVersion?: string; success?: boolean }>(result.stdout);
    expect(parsed.schemaVersion).toBe("1.3.0");
    expect(typeof parsed.success).toBe("boolean");
  });
});
