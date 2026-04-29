import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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
const realFormat = captureModuleExports(await import("../../src/utils/format.ts"));
const realProofProgress = captureModuleExports(
  await import("../../src/utils/proof-progress.ts"),
);
const realRelayer = captureModuleExports(
  await import("../../src/services/relayer.ts"),
);
const canAssertChmodReadOnly =
  process.platform !== "win32" && process.getuid?.() !== 0;
const STATUS_MODULE_RESTORES = [
  ["../../src/services/sdk.ts", realSdk],
  ["../../src/utils/format.ts", realFormat],
  ["../../src/utils/proof-progress.ts", realProofProgress],
  ["../../src/services/relayer.ts", realRelayer],
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

function restoreWritable(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Best effort for temp-dir cleanup.
  }
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

  test.skipIf(!canAssertChmodReadOnly)(
    "reports an unwritable config home as the first setup blocker",
    async () => {
      const parent = createTrackedTempDir("pp-status-handler-readonly-");
      const configHome = join(parent, ".privacy-pools");
      process.env.PRIVACY_POOLS_HOME = configHome;

      try {
        chmodSync(parent, 0o500);

        const { json } = await captureAsyncJsonOutput(() =>
          handleStatusCommand({ check: false }, fakeCommand({ json: true })),
        );

        expect(json.success).toBe(true);
        expect(json.configExists).toBe(false);
        expect(json.recommendedMode).toBe("setup-required");
        expect(json.configHomeWritabilityIssue).toMatchObject({
          code: "home_not_writable",
          reasonCode: "parent_readonly",
        });
        expect(json.blockingIssues[0]).toMatchObject({
          code: "home_not_writable",
          reasonCode: "parent_readonly",
        });
        expect(json.nextActions.at(-1)).toMatchObject({
          command: "init",
          when: "home_not_writable",
          runnable: false,
        });
      } finally {
        restoreWritable(parent);
      }
    },
  );

  test.skipIf(!canAssertChmodReadOnly)(
    "reports an unwritable existing config home as a warning",
    async () => {
      const home = useIsolatedHome();
      mkdirSync(home, { recursive: true, mode: 0o700 });
      saveConfig({ defaultChain: "sepolia" });

      try {
        chmodSync(home, 0o500);

        const { json } = await captureAsyncJsonOutput(() =>
          handleStatusCommand({ check: false }, fakeCommand({ json: true })),
        );

        expect(json.success).toBe(true);
        expect(json.configExists).toBe(true);
        expect(json.configHomeWritabilityIssue).toMatchObject({
          code: "home_not_writable",
          reasonCode: "exists_readonly",
        });
        expect(
          json.warnings.some(
            (issue: { code: string }) => issue.code === "home_not_writable",
          ),
        ).toBe(true);
        expect(
          json.blockingIssues.map((issue: { code: string }) => issue.code),
        ).not.toContain("home_not_writable");
      } finally {
        restoreWritable(home);
      }
    },
  );

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
    expect(stderr).toContain("Wallet:");
    expect(stderr).toMatch(/Config:\s+not found/);
    expect(stderr).toContain("privacy-pools init");
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

  test("reports relayer health and degrades recommended mode when relayer probe fails", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "sepolia" });
    saveMnemonicToFile(
      "test test test test test test test test test test test junk",
    );
    saveSignerKey("0x" + "44".repeat(32));
    const checkRelayerLivenessMock = mock(async () => false);

    mock.module("../../src/services/relayer.ts", () => ({
      ...realRelayer,
      checkRelayerLiveness: checkRelayerLivenessMock,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleStatusCommand(
        { check: "relayer" },
        fakeCommand({ json: true, chain: "sepolia" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.relayerLive).toBe(false);
    expect(json.rpcLive).toBeUndefined();
    expect(json.aspLive).toBeUndefined();
    expect(json.recommendedMode).toBe("read-only");
    expect(json.warnings.map((warning: { code: string }) => warning.code)).toContain(
      "relayer_unreachable",
    );
    expect(checkRelayerLivenessMock).toHaveBeenCalledTimes(1);
  });

  test("shows a human-mode spinner while health checks run", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "sepolia" });

    const startMock = mock(() => undefined);
    const stopMock = mock(() => undefined);
    const spinnerInstance = { start: startMock, stop: stopMock, text: "" };
    const spinnerMock = mock(() => spinnerInstance);
    const withSpinnerProgressMock = mock(
      async (_spin: unknown, _label: string, fn: () => Promise<unknown>) =>
        await fn(),
    );

    mock.module("../../src/utils/format.ts", () => ({
      ...realFormat,
      spinner: spinnerMock,
    }));
    mock.module("../../src/utils/proof-progress.ts", () => ({
      ...realProofProgress,
      withSpinnerProgress: withSpinnerProgressMock,
    }));

    const { stderr } = await captureAsyncOutput(() =>
      handleStatusCommand({}, fakeCommand({ chain: "sepolia" })),
    );

    expect(spinnerMock).toHaveBeenCalledWith("Checking chain health...", false);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(withSpinnerProgressMock).toHaveBeenCalledWith(
      spinnerInstance,
      "Checking chain health",
      expect.any(Function),
    );
    expect(stderr).toContain("Privacy Pools CLI Status");
  });

  test("suppresses the health-check spinner in json mode", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "sepolia" });

    const spinnerMock = mock(() => ({
      start: mock(() => undefined),
      stop: mock(() => undefined),
      text: "",
    }));
    const withSpinnerProgressMock = mock(
      async (_spin: unknown, _label: string, fn: () => Promise<unknown>) =>
        await fn(),
    );

    mock.module("../../src/utils/format.ts", () => ({
      ...realFormat,
      spinner: spinnerMock,
    }));
    mock.module("../../src/utils/proof-progress.ts", () => ({
      ...realProofProgress,
      withSpinnerProgress: withSpinnerProgressMock,
    }));

    await captureAsyncJsonOutput(() =>
      handleStatusCommand({}, fakeCommand({ json: true, chain: "sepolia" })),
    );

    expect(spinnerMock).not.toHaveBeenCalled();
    expect(withSpinnerProgressMock).not.toHaveBeenCalled();
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
