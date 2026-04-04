import { describe, expect, test } from "bun:test";
import { createSeededHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

const OFFLINE_POOL_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
};

describe("--unsigned-format migration error", () => {
  test("deposit --unsigned-format returns INPUT migration error", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorMessage: string;
      error?: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error?.category).toBe("INPUT");
    expect(json.errorMessage).toContain("--unsigned-format has been replaced");
  });

  test("withdraw --unsigned-format returns INPUT migration error", () => {
    const home = createSeededHome("sepolia");
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
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorMessage: string;
      error?: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error?.category).toBe("INPUT");
    expect(json.errorMessage).toContain("--unsigned-format has been replaced");
  });

  test("ragequit --unsigned-format returns INPUT migration error", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--unsigned", "--unsigned-format", "tx", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorMessage: string;
      error?: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error?.category).toBe("INPUT");
    expect(json.errorMessage).toContain("--unsigned-format has been replaced");
  });
});

describe("--unsigned tx format", () => {
  test("deposit --unsigned tx fails closed at pool resolution (not at flag parsing)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--unsigned", "tx", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorCode?: string;
      errorMessage?: string;
      error?: { category: string; hint?: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toContain('No pool found for asset "ETH" on sepolia.');
    expect(json.error?.category).toBe("INPUT");
    expect(json.error?.hint).toContain("ASP may be offline");
  });
});

describe("--json output includes operation field", () => {
  test("deposit --json error output has schemaVersion", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--asset", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_POOL_ENV }
    );
    expect(result.stdout.trim()).not.toBe("");
    const parsed = parseJsonOutput<{ schemaVersion?: string; success?: boolean }>(result.stdout);
    expect(parsed.schemaVersion).toBe("1.7.0");
    expect(typeof parsed.success).toBe("boolean");
  });
});
