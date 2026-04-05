import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";
import { handleStatusCommand } from "../../src/commands/status.ts";
import {
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";
import { saveAccount } from "../../src/services/account-storage.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncOutput,
} from "../helpers/output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_ASP_HOST_SEPOLIA = process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA;
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const STATUS_MODULE_RESTORES = [
  ["../../src/services/sdk.ts", realSdk],
] as const;

function fakeCommand(
  globalOpts: Record<string, unknown> = {},
): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-status-handler-test-");
  process.env.PRIVACY_POOLS_HOME = home;
  return home;
}

afterEach(() => {
  restoreModuleImplementations(STATUS_MODULE_RESTORES);
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  if (ORIGINAL_ASP_HOST_SEPOLIA === undefined) {
    delete process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA;
  } else {
    process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA = ORIGINAL_ASP_HOST_SEPOLIA;
  }
  cleanupTrackedTempDirs();
});

describe("status command handler", () => {
  test("reports an uninitialized setup without selecting a chain", async () => {
    useIsolatedHome();

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleStatusCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.configExists).toBe(false);
    expect(json.selectedChain).toBeNull();
    expect(json.recoveryPhraseSet).toBe(false);
    expect(json.readyForDeposit).toBe(false);
    expect(json.readyForUnsigned).toBe(false);
    expect(json.recommendedMode).toBe("setup-required");
    expect(json.blockingIssues.map((issue: { code: string }) => issue.code)).toEqual([
      "config_missing",
      "recovery_phrase_missing",
    ]);
    expect(json.nextActions[0].command).toBe("init");
    expect(stderr).toBe("");
  });

  test("reports configured state and skips health checks when --check=false", async () => {
    const home = useIsolatedHome();
    saveConfig({
      defaultChain: "sepolia",
      rpcOverrides: { 11155111: "https://rpc.example.invalid" },
    });
    saveMnemonicToFile(
      "test test test test test test test test test test test junk",
    );
    saveSignerKey("0x" + "44".repeat(32));
    saveAccount(11155111, {
      poolAccounts: new Map([[1n, [{ label: 11n, value: 1n }]]]),
    });

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleStatusCommand(
        { check: false },
        fakeCommand({ json: true, chain: "sepolia" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.configExists).toBe(true);
    expect(json.configDir).toBe(home);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.selectedChain).toBe("sepolia");
    expect(json.rpcUrl).toBe("https://rpc.example.invalid");
    expect(json.rpcIsCustom).toBe(true);
    expect(json.recoveryPhraseSet).toBe(true);
    expect(json.signerKeySet).toBe(true);
    expect(json.signerKeyValid).toBe(true);
    expect(json.readyForDeposit).toBe(true);
    expect(json.readyForUnsigned).toBe(true);
    expect(json.recommendedMode).toBe("ready");
    expect(json.accountFiles).toEqual([
      { chain: "sepolia", chainId: 11155111 },
    ]);
    expect(json.healthChecksEnabled).toBeUndefined();
    expect(json.rpcLive).toBeUndefined();
    expect(json.aspLive).toBeUndefined();
    expect(json.nextActions[0].command).toBe("accounts");
    expect(stderr).toBe("");
  });

  test("prints a human-readable summary when not in JSON mode", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleStatusCommand({}, fakeCommand()),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools CLI Status");
    expect(stderr).toContain("Config not found");
    expect(stderr).toContain("Run 'privacy-pools init'");
  });

  test("redacts sensitive custom endpoint details in status output", async () => {
    useIsolatedHome();
    process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA =
      "https://user:pass@asp.example.invalid/api/abcdef1234567890?token=secret";
    saveConfig({
      defaultChain: "sepolia",
      rpcOverrides: {
        11155111:
          "https://user:pass@rpc.example.invalid/v3/abcdef1234567890?apiKey=secret",
      },
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handleStatusCommand(
        { check: false },
        fakeCommand({ json: true, chain: "sepolia" }),
      ),
    );

    expect(json.rpcUrl).toBe(
      "https://rpc.example.invalid/v3/<redacted-segment>",
    );
    expect(json.aspHost).toBe(
      "https://asp.example.invalid/api/<redacted-segment>",
    );
    expect(json.recommendedMode).toBe("setup-required");
    expect(json.blockingIssues.map((issue: { code: string }) => issue.code)).toContain(
      "recovery_phrase_missing",
    );
  });

  test("reports rpc health and signer balance when --check-rpc succeeds", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "sepolia" });
    saveMnemonicToFile(
      "test test test test test test test test test test test junk",
    );
    saveSignerKey("0x" + "44".repeat(32));

    const getBlockNumberMock = mock(async () => 123456n);
    const getBalanceMock = mock(async () => 987654321n);
    mock.module("../../src/services/sdk.ts", () => ({
      ...realSdk,
      getReadOnlyRpcSession: async () => ({
        publicClient: {
          getBalance: getBalanceMock,
        },
        runRead: async (_cacheKey: string, loader: () => Promise<unknown>) => loader(),
        getLatestBlockNumber: getBlockNumberMock,
      }),
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleStatusCommand(
        { checkRpc: true },
        fakeCommand({ json: true, chain: "sepolia" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.rpcLive).toBe(true);
    expect(json.rpcBlockNumber).toBe("123456");
    expect(json.signerBalance).toBe("987654321");
    expect(json.signerBalanceDecimals).toBe(18);
    expect(json.signerBalanceSymbol).toBe("ETH");
    expect(getBlockNumberMock).toHaveBeenCalledTimes(1);
    expect(getBalanceMock).toHaveBeenCalledTimes(1);
  });

  test("keeps rpc live when signer balance lookup fails", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "sepolia" });
    saveMnemonicToFile(
      "test test test test test test test test test test test junk",
    );
    saveSignerKey("0x" + "44".repeat(32));

    const getBlockNumberMock = mock(async () => 777n);
    const getBalanceMock = mock(async () => {
      throw new Error("balance unavailable");
    });
    mock.module("../../src/services/sdk.ts", () => ({
      ...realSdk,
      getReadOnlyRpcSession: async () => ({
        publicClient: {
          getBalance: getBalanceMock,
        },
        runRead: async (_cacheKey: string, loader: () => Promise<unknown>) => loader(),
        getLatestBlockNumber: getBlockNumberMock,
      }),
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleStatusCommand(
        { checkRpc: true },
        fakeCommand({ json: true, chain: "sepolia" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.rpcLive).toBe(true);
    expect(json.rpcBlockNumber).toBe("777");
    expect(json.signerBalance).toBeUndefined();
    expect(json.signerBalanceDecimals).toBeUndefined();
    expect(json.signerBalanceSymbol).toBeUndefined();
  });

  test("marks rpc unhealthy when the block-number probe fails", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "sepolia" });
    saveMnemonicToFile(
      "test test test test test test test test test test test junk",
    );
    saveSignerKey("0x" + "44".repeat(32));

    const getBalanceMock = mock(async () => 123n);
    mock.module("../../src/services/sdk.ts", () => ({
      ...realSdk,
      getReadOnlyRpcSession: async () => ({
        publicClient: {
          getBalance: getBalanceMock,
        },
        runRead: async (_cacheKey: string, loader: () => Promise<unknown>) => loader(),
        getLatestBlockNumber: async () => {
          throw new Error("rpc offline");
        },
      }),
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleStatusCommand(
        { checkRpc: true },
        fakeCommand({ json: true, chain: "sepolia" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.rpcLive).toBe(false);
    expect(json.rpcBlockNumber).toBeUndefined();
    expect(json.signerBalance).toBeUndefined();
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  test("treats malformed saved signer keys as present but invalid", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "sepolia" });
    saveMnemonicToFile(
      "test test test test test test test test test test test junk",
    );
    saveSignerKey("not-a-valid-private-key");

    const { json } = await captureAsyncJsonOutput(() =>
      handleStatusCommand(
        { check: false },
        fakeCommand({ json: true, chain: "sepolia" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.signerKeySet).toBe(true);
    expect(json.signerKeyValid).toBe(false);
    expect(json.signerAddress).toBeNull();
  });
});
