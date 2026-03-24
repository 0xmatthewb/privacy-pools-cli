import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTempHome,
  initSeededHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
  writeTestSecretFiles,
} from "../helpers/cli.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL: "http://127.0.0.1:9",
};

describe("status and init integration", () => {
  test("init + status produce valid JSON and persisted signer", () => {
    const home = createTempHome();
    const initResult = initSeededHome(home, "sepolia");

    expect(initResult.status).toBe(0);
    const initJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      defaultChain: string;
    }>(initResult.stdout);
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
      },
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

  test("status --no-check still succeeds when one account file is corrupt", () => {
    const home = createTempHome();
    mkdirSync(join(home, ".privacy-pools", "accounts"), { recursive: true });
    writeFileSync(
      join(home, ".privacy-pools", "accounts", "1.json"),
      "{{not valid json",
      "utf8",
    );

    const statusResult = runCli(["--json", "status", "--no-check"], { home });
    expect(statusResult.status).toBe(0);

    const statusJson = parseJsonOutput<{
      success: boolean;
      accountFiles: Array<{ chain: string; chainId: number }>;
    }>(statusResult.stdout);

    expect(statusJson.success).toBe(true);
    expect(statusJson.accountFiles).toEqual([]);
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
    }>(accounts.stdout);
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
      "utf8",
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

describe("init machine-mode behavior", () => {
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
      error: { category: string; message: string };
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

  test("--agent implies JSON/non-interactive mode for init", () => {
    const home = createTempHome();
    const { mnemonicPath, privateKeyPath } = writeTestSecretFiles(home);

    const result = runCli(
      [
        "--agent",
        "init",
        "--mnemonic-file",
        mnemonicPath,
        "--private-key-file",
        privateKeyPath,
        "--default-chain",
        "sepolia",
      ],
      { home, timeoutMs: 60_000 },
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
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("--force");
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
});
