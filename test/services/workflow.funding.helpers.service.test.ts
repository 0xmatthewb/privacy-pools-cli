import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Address } from "viem";
import { ensureConfigDir } from "../../src/services/config.ts";
import type { FlowSnapshot } from "../../src/services/workflow.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));

const getPublicClientMock = mock(() => ({
  getBalance: async () => 0n,
  getGasPrice: async () => 1n,
  readContract: async () => 0n,
}));

const RESTORE_DEFINITIONS = [
  ["../../src/services/sdk.ts", realSdk],
] as const;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const NATIVE_ASSET = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const TOKEN_ASSET = "0x00000000000000000000000000000000000000aa";

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-workflow-funding-");
  process.env.PRIVACY_POOLS_HOME = home;
  ensureConfigDir();
  return home;
}

function sampleWorkflow(
  workflowId = "wf-funding-helper",
  patch: Partial<FlowSnapshot> = {},
): FlowSnapshot {
  const now = "2026-04-14T12:00:00.000Z";
  return {
    schemaVersion: "1.0.0",
    workflowId,
    createdAt: now,
    updatedAt: now,
    phase: "awaiting_funding",
    chain: "mainnet",
    asset: "ETH",
    depositAmount: "100",
    recipient: "0x4444444444444444444444444444444444444444",
    walletMode: "new_wallet",
    walletAddress: "0x1111111111111111111111111111111111111111" as Address,
    requiredNativeFunding: "10",
    requiredTokenFunding: null,
    backupConfirmed: true,
    privacyDelayProfile: "balanced",
    privacyDelayConfigured: true,
    assetDecimals: 18,
    ...patch,
  };
}

function samplePool(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "ETH",
    asset: NATIVE_ASSET,
    pool: "0x9999999999999999999999999999999999999999" as Address,
    scope: 1n,
    decimals: 18,
    vettingFeeBPS: 50n,
    deploymentBlock: 1n,
    ...overrides,
  };
}

async function loadWorkflowHelpers() {
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getPublicClient: getPublicClientMock,
  }));

  return await import(
    `../../src/services/workflow.ts?funding-helper=${Date.now()}-${Math.random()}`
  );
}

describe("workflow funding helper coverage", () => {
  afterEach(() => {
    restoreModuleImplementations(RESTORE_DEFINITIONS);
    cleanupTrackedTempDirs();
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }
    getPublicClientMock.mockReset();
    getPublicClientMock.mockImplementation(() => ({
      getBalance: async () => 0n,
      getGasPrice: async () => 1n,
      readContract: async () => 0n,
    }));
  });

  test("warning helpers stay semantic and fail closed on malformed amount metadata", async () => {
    const workflowHelpers = await loadWorkflowHelpers();
    const {
      getFlowWarningAmount,
      buildAmountPatternLinkabilityWarning,
      buildFlowAmountPrivacyWarning,
      buildFlowPrivacyDelayWarning,
    } = workflowHelpers;

    expect(
      getFlowWarningAmount(sampleWorkflow("wf-missing-amount", {
        committedValue: null,
        estimatedCommittedValue: null,
      })),
    ).toBeNull();

    expect(
      getFlowWarningAmount(sampleWorkflow("wf-malformed-amount", {
        committedValue: "not-a-bigint",
      })),
    ).toBeNull();

    expect(
      getFlowWarningAmount(sampleWorkflow("wf-estimated-amount", {
        committedValue: null,
        estimatedCommittedValue: "123456789",
        assetDecimals: 6,
      })),
    ).toEqual({
      amount: 123456789n,
      estimated: true,
    });

    expect(
      buildAmountPatternLinkabilityWarning(1000000000000000000n, 18, "ETH"),
    ).toBeNull();

    expect(
      buildAmountPatternLinkabilityWarning(123000000000000000n, 18, "ETH", {
        estimated: true,
      }),
    ).toMatchObject({
      code: "amount_pattern_linkability",
      category: "privacy",
    });

    expect(
      buildFlowAmountPrivacyWarning(
        sampleWorkflow("wf-terminal", {
          phase: "completed",
          committedValue: "123000000000000000",
        }),
      ),
    ).toBeNull();

    expect(
      buildFlowAmountPrivacyWarning(
        sampleWorkflow("wf-warning", {
          phase: "approved_ready_to_withdraw",
          committedValue: "123000000000000000",
        }),
      ),
    ).toMatchObject({
      code: "amount_pattern_linkability",
    });

    expect(
      buildFlowPrivacyDelayWarning(
        sampleWorkflow("wf-off", {
          phase: "approved_ready_to_withdraw",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
        }),
      ),
    ).toMatchObject({
      code: "timing_delay_disabled",
    });

    expect(
      buildFlowPrivacyDelayWarning(
        sampleWorkflow("wf-force", {
          phase: "completed",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
        }),
        { forceConfiguredPrivacyDelayWarning: true },
      ),
    ).toMatchObject({
      code: "timing_delay_disabled",
    });
  });

  test("readFlowFundingState rejects missing wallet addresses and tracks native/token funding satisfaction", async () => {
    const workflowHelpers = await loadWorkflowHelpers();
    const { readFlowFundingState } = workflowHelpers;

    await expect(
      readFlowFundingState({
        snapshot: sampleWorkflow("wf-missing-wallet", {
          walletAddress: null,
        }),
        pool: samplePool(),
      }),
    ).rejects.toThrow("Workflow wallet address is missing.");

    getPublicClientMock.mockImplementationOnce(() => ({
      getBalance: async () => 120n,
      getGasPrice: async () => 1n,
      readContract: async () => {
        throw new Error("should not be called for native pools");
      },
    }));
    await expect(
      readFlowFundingState({
        snapshot: sampleWorkflow("wf-native", {
          requiredNativeFunding: "100",
          requiredTokenFunding: null,
        }),
        pool: samplePool(),
      }),
    ).resolves.toEqual({
      nativeBalance: 120n,
      tokenBalance: null,
      nativeSatisfied: true,
      tokenSatisfied: true,
    });

    getPublicClientMock.mockImplementationOnce(() => ({
      getBalance: async () => 50n,
      getGasPrice: async () => 1n,
      readContract: async () => 75n,
    }));
    await expect(
      readFlowFundingState({
        snapshot: sampleWorkflow("wf-token", {
          asset: "USDC",
          assetDecimals: 6,
          requiredNativeFunding: "60",
          requiredTokenFunding: "100",
        }),
        pool: samplePool({
          symbol: "USDC",
          asset: TOKEN_ASSET,
          decimals: 6,
        }),
      }),
    ).resolves.toEqual({
      nativeBalance: 50n,
      tokenBalance: 75n,
      nativeSatisfied: false,
      tokenSatisfied: false,
    });
  });

  test("refreshWorkflowFundingRequirements refreshes new-wallet pre-deposit requirements and leaves other snapshots untouched", async () => {
    useIsolatedHome();
    const workflowHelpers = await loadWorkflowHelpers();
    const { refreshWorkflowFundingRequirements } = workflowHelpers;

    const configuredSnapshot = sampleWorkflow("wf-configured", {
      walletMode: "configured",
    });
    await expect(
      refreshWorkflowFundingRequirements({
        snapshot: configuredSnapshot,
        chainConfig: { id: 1, name: "mainnet" } as never,
        pool: samplePool(),
      }),
    ).resolves.toBe(configuredSnapshot);

    const depositedSnapshot = sampleWorkflow("wf-deposited", {
      depositTxHash: "0x" + "aa".repeat(32),
    });
    await expect(
      refreshWorkflowFundingRequirements({
        snapshot: depositedSnapshot,
        chainConfig: { id: 1, name: "mainnet" } as never,
        pool: samplePool(),
      }),
    ).resolves.toBe(depositedSnapshot);

    getPublicClientMock.mockImplementationOnce(() => ({
      getBalance: async () => 0n,
      getGasPrice: async () => 2n,
      readContract: async () => 0n,
    }));

    const refreshed = await refreshWorkflowFundingRequirements({
      snapshot: sampleWorkflow("wf-refresh", {
        requiredNativeFunding: null,
      }),
      chainConfig: { id: 1, name: "mainnet" } as never,
      pool: samplePool(),
    });

    expect(refreshed.requiredNativeFunding).toBeTruthy();
    expect(refreshed.requiredTokenFunding).toBeNull();
    expect(BigInt(refreshed.requiredNativeFunding!)).toBeGreaterThan(100n);

    getPublicClientMock.mockImplementationOnce(() => ({
      getBalance: async () => 0n,
      getGasPrice: async () => 3n,
      readContract: async () => 0n,
    }));
    const refreshedToken = await refreshWorkflowFundingRequirements({
      snapshot: sampleWorkflow("wf-refresh-token", {
        asset: "USDC",
        depositAmount: "2500",
        assetDecimals: 6,
        requiredNativeFunding: null,
        requiredTokenFunding: null,
      }),
      chainConfig: { id: 1, name: "mainnet" } as never,
      pool: samplePool({
        symbol: "USDC",
        asset: TOKEN_ASSET,
        decimals: 6,
      }),
    });

    expect(refreshedToken.requiredTokenFunding).toBe("2500");
    expect(BigInt(refreshedToken.requiredNativeFunding!)).toBeGreaterThan(0n);
  });
});
