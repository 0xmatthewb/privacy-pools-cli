import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempHome, initSeededHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

describe("CLI command integration", () => {
  test("init + status produce valid JSON and persisted signer", () => {
    const home = createTempHome();
    const initResult = initSeededHome(home, "sepolia");

    expect(initResult.status).toBe(0);
    const initJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      defaultChain: string;
    }>(
      initResult.stdout
    );
    expect(initJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(initJson.success).toBe(true);
    expect(initJson.defaultChain).toBe("sepolia");

    const statusResult = runCli(["--json", "status"], { home });
    expect(statusResult.status).toBe(0);

    const statusJson = parseJsonOutput<{
      schemaVersion: string;
      configExists: boolean;
      defaultChain: string;
      mnemonicSet: boolean;
      signerKeySet: boolean;
      signerAddress: string;
    }>(statusResult.stdout);

    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.configExists).toBe(true);
    expect(statusJson.defaultChain).toBe("sepolia");
    expect(statusJson.mnemonicSet).toBe(true);
    expect(statusJson.signerKeySet).toBe(true);
    expect(statusJson.signerAddress).toBe("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A");
  });

  test("deposit without --asset in --yes mode fails with INPUT error", () => {
    const home = createTempHome();
    initSeededHome(home);

    const result = runCli(["--json", "deposit", "0.1", "--yes"], { home });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(
      result.stdout
    );
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("withdraw without --to in relayed mode fails fast", () => {
    const home = createTempHome();
    initSeededHome(home);

    const result = runCli(["--json", "withdraw", "0.1", "--yes"], { home });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(
      result.stdout
    );
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("ragequit without --asset in --yes mode fails with INPUT error", () => {
    const home = createTempHome();

    const result = runCli(["--json", "ragequit", "--yes"], { home });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(
      result.stdout
    );
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("balance/accounts keep JSON contract when pools resolve to empty set", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    // Use an intentionally unreachable RPC so on-chain pool validation fails and listPools
    // returns an empty set while keeping this test deterministic and non-funded.
    const rpcUrl = "http://127.0.0.1:9";

    const balance = runCli(
      ["--json", "--chain", "ethereum", "--rpc-url", rpcUrl, "balance"],
      { home, timeoutMs: 60_000 }
    );
    expect(balance.status).toBe(0);
    const balanceJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      chain: string;
      balances: unknown[];
    }>(
      balance.stdout
    );
    expect(balanceJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(balanceJson.success).toBe(true);
    expect(balanceJson.chain).toBe("ethereum");
    expect(Array.isArray(balanceJson.balances)).toBe(true);

    const accounts = runCli(
      ["--json", "--chain", "ethereum", "--rpc-url", rpcUrl, "accounts"],
      { home, timeoutMs: 60_000 }
    );
    expect(accounts.status).toBe(0);
    const accountsJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      chain: string;
      accounts: unknown[];
    }>(
      accounts.stdout
    );
    expect(accountsJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(accountsJson.success).toBe(true);
    expect(accountsJson.chain).toBe("ethereum");
    expect(Array.isArray(accountsJson.accounts)).toBe(true);
  });

  test("status reports invalid signer key without false-positive signer address", () => {
    const home = createTempHome();
    const cfgDir = join(home, ".privacy-pools");
    mkdirSync(cfgDir, { recursive: true });

    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ defaultChain: "ethereum", rpcOverrides: {} }, null, 2),
      "utf8"
    );
    writeFileSync(join(cfgDir, ".mnemonic"), "test test test test test test test test test test test junk", "utf8");
    writeFileSync(join(cfgDir, ".signer"), "not-a-private-key", "utf8");

    const statusResult = runCli(["--json", "status"], { home, timeoutMs: 60_000 });
    expect(statusResult.status).toBe(0);

    const statusJson = parseJsonOutput<{
      schemaVersion: string;
      signerKeySet: boolean;
      signerKeyValid: boolean;
      signerAddress: string | null;
    }>(statusResult.stdout);

    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.signerKeySet).toBe(true);
    expect(statusJson.signerKeyValid).toBe(false);
    expect(statusJson.signerAddress).toBeNull();
  });

  test("malformed config fails with INPUT category", () => {
    const home = createTempHome();
    const cfgDir = join(home, ".privacy-pools");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, "config.json"), "{invalid json", "utf8");

    const statusResult = runCli(["--json", "status"], { home, timeoutMs: 60_000 });
    expect(statusResult.status).toBe(2);

    const statusJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; code: string; message: string };
    }>(statusResult.stdout);
    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.success).toBe(false);
    expect(statusJson.error.category).toBe("INPUT");
    expect(statusJson.error.code).toBe("INPUT_ERROR");
    expect(statusJson.error.message).toContain("Config file is not valid JSON");
  });

  test("sync command preserves JSON envelope with deterministic empty-pool state", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    // Keep deterministic and non-funded: unreachable RPC path returns no resolved pools.
    const rpcUrl = "http://127.0.0.1:9";
    const result = runCli(
      ["--json", "--chain", "ethereum", "--rpc-url", rpcUrl, "sync"],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      chain: string;
      syncedPools: number;
      spendableCommitments: number;
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("ethereum");
    expect(json.syncedPools).toBe(0);
    expect(json.spendableCommitments).toBe(0);
  });

  test("withdraw quote without --asset fails with INPUT envelope", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["--json", "withdraw", "quote", "0.1"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("deposit --unsigned emits machine-readable INPUT error without --asset", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["deposit", "0.1", "--unsigned"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; code: string };
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.code).toBe("INPUT_ERROR");
  });

  test("withdraw --unsigned emits machine-readable INPUT error without --asset", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["withdraw", "0.1", "--unsigned"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; code: string };
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.code).toBe("INPUT_ERROR");
  });

  test("ragequit --unsigned emits machine-readable INPUT error without --asset", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["ragequit", "--unsigned"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; code: string };
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.code).toBe("INPUT_ERROR");
  });

  test("deposit positional alias parses asset-first form (deposit ETH 0.1)", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(
      ["--json", "--chain", "ethereum", "--rpc-url", "http://127.0.0.1:9", "deposit", "ETH", "0.1", "--yes"],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain('No pool found for asset "ETH"');
  });

  test("withdraw quote positional alias parses asset-first form (withdraw quote ETH 0.1)", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(
      ["--json", "--chain", "ethereum", "--rpc-url", "http://127.0.0.1:9", "withdraw", "quote", "ETH", "0.1"],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain('No pool found for asset "ETH"');
  });

  test("withdraw positional alias parses asset-first form (withdraw ETH 0.1 --direct)", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(
      ["--json", "--chain", "ethereum", "--rpc-url", "http://127.0.0.1:9", "withdraw", "ETH", "0.1", "--direct", "--yes"],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain('No pool found for asset "ETH"');
  });

  test("ragequit positional alias parses asset-only form (ragequit ETH)", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(
      ["--json", "--chain", "ethereum", "--rpc-url", "http://127.0.0.1:9", "ragequit", "ETH", "--yes"],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain('No pool found for asset "ETH"');
  });

  test("positional + --asset together is rejected as ambiguous", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(["--json", "deposit", "ETH", "0.1", "--asset", "ETH", "--yes"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Ambiguous positional arguments");
  });

});
