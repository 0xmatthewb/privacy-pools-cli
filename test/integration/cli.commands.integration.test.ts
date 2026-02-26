import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempHome, initSeededHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

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

  test("status honors --chain override without mutating configured defaultChain", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const statusResult = runCli(["--json", "--chain", "sepolia", "status"], {
      home,
      timeoutMs: 60_000,
    });
    expect(statusResult.status).toBe(0);

    const statusJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      defaultChain: string | null;
      selectedChain: string | null;
      rpcUrl: string | null;
    }>(statusResult.stdout);

    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.success).toBe(true);
    expect(statusJson.defaultChain).toBe("ethereum");
    expect(statusJson.selectedChain).toBe("sepolia");
    expect(typeof statusJson.rpcUrl).toBe("string");
    expect(statusJson.rpcUrl).toContain("sepolia");
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

  test("balance/accounts keep JSON contract when ASP is unreachable", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const balance = runCli(["--json", "--chain", "ethereum", "balance"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(balance.status).toBe(4);
    const balanceJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(
      balance.stdout
    );
    expect(balanceJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(balanceJson.success).toBe(false);
    expect(balanceJson.error.category).toBe("ASP");

    const accounts = runCli(["--json", "--chain", "ethereum", "accounts"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(accounts.status).toBe(4);
    const accountsJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(
      accounts.stdout
    );
    expect(accountsJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(accountsJson.success).toBe(false);
    expect(accountsJson.error.category).toBe("ASP");
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

  test("sync command preserves JSON envelope when ASP is unreachable", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(["--json", "--chain", "ethereum", "sync"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(4);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("ASP");
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
      [
        "--json",
        "--chain",
        "ethereum",
        "--rpc-url",
        "http://127.0.0.1:9",
        "deposit",
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        "0.1",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain(
      "No pool found for asset 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    );
  });

  test("withdraw quote positional alias parses asset-first form (withdraw quote ETH 0.1)", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(
      [
        "--json",
        "--chain",
        "ethereum",
        "--rpc-url",
        "http://127.0.0.1:9",
        "withdraw",
        "quote",
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        "0.1",
      ],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain(
      "No pool found for asset 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    );
  });

  test("withdraw positional alias parses asset-first form (withdraw ETH 0.1 --direct)", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(
      [
        "--json",
        "--chain",
        "ethereum",
        "--rpc-url",
        "http://127.0.0.1:9",
        "withdraw",
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        "0.1",
        "--direct",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain(
      "No pool found for asset 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    );
  });

  test("ragequit positional alias parses asset-only form (ragequit ETH)", () => {
    const home = createTempHome();
    initSeededHome(home, "ethereum");

    const result = runCli(
      [
        "--json",
        "--chain",
        "ethereum",
        "--rpc-url",
        "http://127.0.0.1:9",
        "ragequit",
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain(
      "No pool found for asset 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    );
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

  test("--json init is non-interactive without --yes", () => {
    const home = createTempHome();
    const result = runCli(["--json", "init", "--skip-circuits"], {
      home,
      timeoutMs: 60_000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("Wallet setup:");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      defaultChain: string;
      mnemonic?: string;
      mnemonicRedacted?: boolean;
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("ethereum");
    expect(json.mnemonic).toBeUndefined();
    expect(json.mnemonicRedacted).toBe(true);
  });

  test("--json init refuses to overwrite existing state without --force", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["--json", "init", "--skip-circuits"], {
      home,
      timeoutMs: 60_000,
    });

    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      error: { category: string; message: string; hint?: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Refusing to overwrite");
    expect(json.error.hint).toContain("--force");
  });

  test("--json init --force allows overwrite and reports persisted signerKeySet accurately", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["--json", "init", "--skip-circuits", "--force"], {
      home,
      timeoutMs: 60_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      defaultChain: string;
      signerKeySet: boolean;
      mnemonic?: string;
      mnemonicRedacted?: boolean;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.signerKeySet).toBe(true);
    expect(json.mnemonic).toBeUndefined();
    expect(json.mnemonicRedacted).toBe(true);
  });

  test("--json init --show-mnemonic includes generated mnemonic", () => {
    const result = runCli(["--json", "init", "--skip-circuits", "--show-mnemonic"], {
      home: createTempHome(),
      timeoutMs: 60_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      mnemonic?: string;
      mnemonicRedacted?: boolean;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(typeof json.mnemonic).toBe("string");
    expect(json.mnemonic?.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
    expect(json.mnemonicRedacted).toBeUndefined();
  });

  test("--json deposit is non-interactive and fails fast without --asset", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["--json", "deposit", "0.1"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain("Select asset to deposit");

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No asset specified");
  });

  test("--json withdraw is non-interactive and fails fast without --asset", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["--json", "withdraw", "0.1", "--direct"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain("Select asset to withdraw");

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No asset specified");
  });

  test("--json ragequit is non-interactive and fails fast without --asset", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["--json", "ragequit"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain("Select asset pool for ragequit");

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No asset specified");
  });

  test("--agent implies JSON/non-interactive mode for init", () => {
    const home = createTempHome();
    const mnemonic = "test test test test test test test test test test test junk";
    const privateKey = "0x1111111111111111111111111111111111111111111111111111111111111111";

    const result = runCli(
      [
        "--agent",
        "init",
        "--mnemonic",
        mnemonic,
        "--private-key",
        privateKey,
        "--default-chain",
        "sepolia",
        "--skip-circuits",
      ],
      { home, timeoutMs: 60_000 }
    );

    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      defaultChain: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
  });

  test("--agent init refuses overwrite without --force", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runCli(["--agent", "init", "--skip-circuits"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      error: { category: string; message: string; hint?: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Refusing to overwrite");
    expect(json.error.hint).toContain("--force");
  });

  test("machine-mode parse errors are JSON (unknown command via --agent)", () => {
    const result = runCli(["--agent", "not-a-command"], { home: createTempHome() });
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
    expect(json.errorMessage.toLowerCase()).toContain("unknown command");
  });

  test("--unsigned-format tx requires --unsigned (agent mode)", () => {
    const result = runCli(
      ["--agent", "deposit", "0.1", "--asset", "ETH", "--unsigned-format", "tx"],
      { home: createTempHome() }
    );
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
    expect(json.errorMessage).toContain("--unsigned-format requires --unsigned");
  });

  test("machine-mode help subcommand returns JSON envelope", () => {
    const result = runCli(["--agent", "help", "deposit"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      help: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Usage: privacy-pools deposit");
    expect(json.help).not.toContain("(outputHelp)");
  });

  test("--json help subcommand returns JSON envelope", () => {
    const result = runCli(["--json", "help", "deposit"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      help: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Usage: privacy-pools deposit");
    expect(json.help).not.toContain("(outputHelp)");
  });

  test("--agent guide returns JSON payload", () => {
    const result = runCli(["--agent", "guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      guide: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.guide).toContain("without --json");
  });

  test("--agent init with generated mnemonic is stdout-json only", () => {
    const result = runCli(["--agent", "init", "--skip-circuits"], {
      home: createTempHome(),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mnemonic?: string;
      mnemonicRedacted?: boolean;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mnemonic).toBeUndefined();
    expect(json.mnemonicRedacted).toBe(true);
  });

  test("--agent init --show-mnemonic includes generated mnemonic", () => {
    const result = runCli(["--agent", "init", "--skip-circuits", "--show-mnemonic"], {
      home: createTempHome(),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      mnemonic?: string;
      mnemonicRedacted?: boolean;
    }>(result.stdout);
    expect(json.success).toBe(true);
    expect(typeof json.mnemonic).toBe("string");
    expect(json.mnemonic?.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
    expect(json.mnemonicRedacted).toBeUndefined();
  });

  test("--agent version returns JSON envelope", () => {
    const result = runCli(["--agent", "--version"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      version: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("version");
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--agent with no command returns JSON help envelope", () => {
    const result = runCli(["--agent"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      help: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Usage: privacy-pools");
  });

  test("--json with no command returns JSON help envelope", () => {
    const result = runCli(["--json"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      help: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Usage: privacy-pools");
  });

});
