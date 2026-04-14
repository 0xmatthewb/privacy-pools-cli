import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CHAINS, getDefaultReadOnlyChains } from "../../src/config/chains.ts";
import { CLIError } from "../../src/utils/errors.ts";
const realPoolsService = await import("../../src/services/pools.ts");
const realSdkService = await import("../../src/services/sdk.ts");
const realAccountService = await import("../../src/services/account.ts");
const realAccountStorage = await import("../../src/services/account-storage.ts");

const listKnownPoolsFromRegistryMock = mock(async () => [
  {
    pool: "0x" + "11".repeat(20),
    scope: 1n,
    deploymentBlock: 1n,
  },
]);
const getDataServiceMock = mock(async () => ({ kind: "data-service" }));
const initializeAccountServiceWithStateMock = mock(async () => ({}));
const toPoolInfoMock = mock((poolInfo: unknown) => poolInfo);
const accountHasDepositsMock = mock((_chainId: number) => false);

let discoverLoadedAccounts: typeof import("../../src/services/init-discovery.ts").discoverLoadedAccounts;

async function loadInitDiscovery(): Promise<void> {
  mock.module("../../src/services/pools.ts", () => ({
    ...realPoolsService,
    listKnownPoolsFromRegistry: listKnownPoolsFromRegistryMock,
  }));
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdkService,
    getDataService: getDataServiceMock,
  }));
  mock.module("../../src/services/account.ts", () => ({
    ...realAccountService,
    initializeAccountServiceWithState: initializeAccountServiceWithStateMock,
    toPoolInfo: toPoolInfoMock,
  }));
  mock.module("../../src/services/account-storage.ts", () => ({
    ...realAccountStorage,
    accountHasDeposits: accountHasDepositsMock,
  }));

  ({ discoverLoadedAccounts } = await import(
    `../../src/services/init-discovery.ts?test=${Date.now()}-${Math.random()}`
  ));
}

describe("init discovery service", () => {
  beforeEach(async () => {
    mock.restore();
    listKnownPoolsFromRegistryMock.mockClear();
    getDataServiceMock.mockClear();
    initializeAccountServiceWithStateMock.mockClear();
    toPoolInfoMock.mockClear();
    accountHasDepositsMock.mockClear();

    listKnownPoolsFromRegistryMock.mockImplementation(async () => [
      {
        pool: "0x" + "11".repeat(20),
        scope: 1n,
        deploymentBlock: 1n,
      },
    ]);
    getDataServiceMock.mockImplementation(async () => ({ kind: "data-service" }));
    initializeAccountServiceWithStateMock.mockImplementation(async () => ({}));
    toPoolInfoMock.mockImplementation((poolInfo: unknown) => poolInfo);
    accountHasDepositsMock.mockImplementation((_chainId: number) => false);

    await loadInitDiscovery();
  });

  afterEach(() => {
    mock.restore();
  });

  test("reports discovered deposits and progress across the default read-only chains", async () => {
    const expectedChains = getDefaultReadOnlyChains().map((chain) => chain.name);
    const progressEvents: Array<{
      currentChain: string;
      completedChains: number;
      totalChains: number;
    }> = [];
    accountHasDepositsMock.mockImplementation(
      (chainId: number) => chainId === CHAINS.arbitrum.id,
    );

    const result = await discoverLoadedAccounts(
      "test test test test test test test test test test test junk",
      {
        defaultChain: "mainnet",
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      },
    );

    expect(result).toEqual({
      status: "deposits_found",
      chainsChecked: expectedChains,
      foundAccountChains: ["arbitrum"],
    });
    expect(progressEvents).toEqual(
      expectedChains.map((currentChain, index) => ({
        currentChain,
        completedChains: index,
        totalChains: expectedChains.length,
      })),
    );
    expect(initializeAccountServiceWithStateMock).toHaveBeenCalledTimes(
      expectedChains.length,
    );
    expect(toPoolInfoMock).toHaveBeenCalled();
  });

  test("includes the selected testnet in discovery when the default chain is a testnet", async () => {
    const expectedChains = [
      ...getDefaultReadOnlyChains().map((chain) => chain.name),
      "sepolia",
    ];

    const result = await discoverLoadedAccounts(
      "test test test test test test test test test test test junk",
      {
        defaultChain: "sepolia",
      },
    );

    expect(result).toEqual({
      status: "no_deposits",
      chainsChecked: expectedChains,
    });
    expect(listKnownPoolsFromRegistryMock).toHaveBeenCalledTimes(
      expectedChains.length,
    );
  });

  test("returns degraded when discovery encounters empty registries or generic failures", async () => {
    listKnownPoolsFromRegistryMock.mockImplementation(async (chain) => {
      if (chain.name === "mainnet") {
        return [];
      }
      if (chain.name === "arbitrum") {
        throw new Error("rpc unavailable");
      }
      return [
        {
          pool: "0x" + "22".repeat(20),
          scope: 2n,
          deploymentBlock: 2n,
        },
      ];
    });

    const result = await discoverLoadedAccounts(
      "test test test test test test test test test test test junk",
      {
        defaultChain: "mainnet",
      },
    );

    expect(result).toEqual({
      status: "degraded",
      chainsChecked: getDefaultReadOnlyChains().map((chain) => chain.name),
    });
  });

  test("surfaces website-action-required discovery while preserving any found chains", async () => {
    accountHasDepositsMock.mockImplementation(
      (chainId: number) => chainId === CHAINS.mainnet.id,
    );
    initializeAccountServiceWithStateMock.mockImplementation(
      async (_dataService, _mnemonic, _pools, chainId: number) => {
        if (chainId === CHAINS.arbitrum.id) {
          throw new CLIError(
            "legacy migration required",
            "INPUT",
            "Use the website first.",
            "ACCOUNT_MIGRATION_REQUIRED",
          );
        }
        return {};
      },
    );

    const result = await discoverLoadedAccounts(
      "test test test test test test test test test test test junk",
      {
        defaultChain: "mainnet",
      },
    );

    expect(result).toEqual({
      status: "legacy_website_action_required",
      chainsChecked: getDefaultReadOnlyChains().map((chain) => chain.name),
      foundAccountChains: ["mainnet"],
    });
  });
});
