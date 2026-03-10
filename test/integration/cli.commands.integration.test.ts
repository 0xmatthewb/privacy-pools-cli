import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempHome, initSeededHome, mustInitSeededHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL: "http://127.0.0.1:9",
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
      recoveryPhraseSet: boolean;
      signerKeySet: boolean;
      signerAddress: string;
    }>(statusResult.stdout);

    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.configExists).toBe(true);
    expect(statusJson.defaultChain).toBe("sepolia");
    expect(statusJson.recoveryPhraseSet).toBe(true);
    expect(statusJson.signerKeySet).toBe(true);
    expect(statusJson.signerAddress).toBe("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A");
  });

  test("status honors --chain override without mutating configured defaultChain", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");

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
    expect(statusJson.defaultChain).toBe("mainnet");
    expect(statusJson.selectedChain).toBe("sepolia");
    expect(typeof statusJson.rpcUrl).toBe("string");
    expect(statusJson.rpcUrl).toContain("sepolia");
  });

  test("status --check runs both health checks", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const statusResult = runCli(
      ["-j", "-c", "sepolia", "--rpc-url", "http://127.0.0.1:9", "status", "--check"],
      {
        home,
        timeoutMs: 30_000,
        env: OFFLINE_ASP_ENV,
      }
    );
    expect(statusResult.status).toBe(0);

    const statusJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      aspLive?: unknown;
      rpcLive?: unknown;
    }>(statusResult.stdout);

    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.success).toBe(true);
    expect(typeof statusJson.aspLive).toBe("boolean");
    expect(typeof statusJson.rpcLive).toBe("boolean");
  });

  test("deposit without --asset in --yes mode fails with INPUT error", () => {
    const home = createTempHome();
    mustInitSeededHome(home);

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
    mustInitSeededHome(home);

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

  test("exit alias without --asset in --yes mode fails with INPUT error", () => {
    const home = createTempHome();

    const result = runCli(["--json", "exit", "--yes"], { home });
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

  test("accounts keeps JSON contract when ASP is unreachable", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");

    const accounts = runCli(["--json", "--chain", "mainnet", "accounts"], {
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
      JSON.stringify({ defaultChain: "mainnet", rpcOverrides: {} }, null, 2),
      "utf8"
    );
    writeFileSync(join(cfgDir, ".mnemonic"), "test test test test test test test test test test test junk", "utf8");
    writeFileSync(join(cfgDir, ".signer"), "not-a-private-key", "utf8");

    const statusResult = runCli(["--json", "status"], { home, env: OFFLINE_ENV });
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
    mustInitSeededHome(home, "mainnet");

    const result = runCli(["--json", "--chain", "mainnet", "sync"], {
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
    mustInitSeededHome(home, "sepolia");

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
    mustInitSeededHome(home, "sepolia");

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
    mustInitSeededHome(home, "sepolia");

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
    mustInitSeededHome(home, "sepolia");

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
    mustInitSeededHome(home, "mainnet");

    const result = runCli(
      [
        "--json",
        "--chain",
        "mainnet",
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
    mustInitSeededHome(home, "mainnet");

    const result = runCli(
      [
        "--json",
        "--chain",
        "mainnet",
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
    mustInitSeededHome(home, "mainnet");

    const result = runCli(
      [
        "--json",
        "--chain",
        "mainnet",
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
    mustInitSeededHome(home, "mainnet");

    const result = runCli(
      [
        "--json",
        "--chain",
        "mainnet",
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
    mustInitSeededHome(home, "mainnet");

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
    const result = runCli(["--json", "init"], {
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
      recoveryPhrase?: string;
      recoveryPhraseRedacted?: boolean;
    }>(result.stdout);

    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("mainnet");
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.recoveryPhraseRedacted).toBe(true);
  });

  test("--json init refuses to overwrite existing state without --force", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(["--json", "init"], {
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
    expect(json.error.message).toContain("--force");
  });

  test("--json init --force allows overwrite and reports persisted signerKeySet accurately", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(["--json", "init", "--force"], {
      home,
      timeoutMs: 60_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      defaultChain: string;
      signerKeySet: boolean;
      recoveryPhrase?: string;
      recoveryPhraseRedacted?: boolean;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.signerKeySet).toBe(true);
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.recoveryPhraseRedacted).toBe(true);
  });

  test("--json init --show-mnemonic includes generated mnemonic", () => {
    const result = runCli(["--json", "init", "--show-mnemonic"], {
      home: createTempHome(),
      timeoutMs: 60_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      recoveryPhrase?: string;
      recoveryPhraseRedacted?: boolean;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(typeof json.recoveryPhrase).toBe("string");
    expect(json.recoveryPhrase?.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
    expect(json.recoveryPhraseRedacted).toBeUndefined();
  });

  test("--json deposit is non-interactive and fails fast without --asset", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

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
    mustInitSeededHome(home, "sepolia");

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
    mustInitSeededHome(home, "sepolia");

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

  test("--json exit is non-interactive and fails fast without --asset", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(["--json", "exit"], {
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

  test("withdraw rejects malformed --from-pa before network calls", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      ["--json", "withdraw", "0.1", "--asset", "ETH", "--to", "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A", "--from-pa", "not-a-pa", "--chain", "sepolia"],
      { home, timeoutMs: 10_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Invalid --from-pa");
  });

  test("direct withdraw rejects --to that does not match signer before network calls", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      [
        "--json",
        "withdraw",
        "0.1",
        "--asset",
        "ETH",
        "--direct",
        "--to",
        "0x0000000000000000000000000000000000000001",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 10_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("must match your signer address");
  });

  test("ragequit rejects malformed --from-pa before network calls", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--from-pa", "not-a-pa", "--chain", "sepolia"],
      { home, timeoutMs: 10_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Invalid --from-pa");
  });

  test("ragequit rejects --from-pa when combined with deprecated --commitment", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--from-pa", "PA-1", "--commitment", "0", "--chain", "sepolia"],
      { home, timeoutMs: 10_000 }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Cannot use --from-pa and --commitment together");
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
    mustInitSeededHome(home, "sepolia");

    const result = runCli(["--agent", "init"], {
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
    expect(json.error.message).toContain("--force");
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
      mode: string;
      help: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(typeof json.help).toBe("string");
  });

  test("--agent init with generated mnemonic is stdout-json only", () => {
    const result = runCli(["--agent", "init"], {
      home: createTempHome(),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      recoveryPhrase?: string;
      recoveryPhraseRedacted?: boolean;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.recoveryPhraseRedacted).toBe(true);
  });

  test("--agent init --show-mnemonic includes generated mnemonic", () => {
    const result = runCli(["--agent", "init", "--show-mnemonic"], {
      home: createTempHome(),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      recoveryPhrase?: string;
      recoveryPhraseRedacted?: boolean;
    }>(result.stdout);
    expect(json.success).toBe(true);
    expect(typeof json.recoveryPhrase).toBe("string");
    expect(json.recoveryPhrase?.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
    expect(json.recoveryPhraseRedacted).toBeUndefined();
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

  test("capabilities --json returns accurate command/global flag catalog", () => {
    const result = runCli(["--json", "capabilities"], { home: createTempHome() });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      commands: Array<{ name: string }>;
      globalFlags: Array<{ flag: string }>;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.commands.map((c) => c.name)).toContain("history");
    expect(json.commands.map((c) => c.name)).toContain("completion");
    expect(json.commands.map((c) => c.name)).toContain("capabilities");
    expect(json.commands.map((c) => c.name)).toContain("activity");
    expect(json.commands.map((c) => c.name)).toContain("stats");

    const globalFlagStrings = json.globalFlags.map((f) => f.flag);
    expect(globalFlagStrings).toContain("-j, --json");
    expect(globalFlagStrings).toContain("-y, --yes");
    expect(globalFlagStrings).not.toContain("--unsigned");
    expect(globalFlagStrings).not.toContain("--dry-run");
  });

  test("history --json without init fails with INPUT error", () => {
    const result = runCli(["--json", "history", "--chain", "sepolia"], {
      home: createTempHome(),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No recovery phrase found");
  });

});
