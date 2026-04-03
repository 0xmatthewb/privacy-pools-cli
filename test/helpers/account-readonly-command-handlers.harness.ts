import {
  afterEach,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "./module-mocks.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "./output.ts";
import { createTestWorld, type TestWorld } from "./test-world.ts";

const realAccount = captureModuleExports(
  await import("../../src/services/account.ts"),
);
const realPoolAccounts = captureModuleExports(
  await import("../../src/utils/pool-accounts.ts"),
);
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realSdkPackage = captureModuleExports(
  await import("@0xbow/privacy-pools-core-sdk"),
);
const realAsp = captureModuleExports(await import("../../src/services/asp.ts"));
const realMigration = captureModuleExports(
  await import("../../src/services/migration.ts"),
);

const READONLY_HANDLER_MODULE_RESTORES = [
  ["../../src/services/account.ts", realAccount],
  ["../../src/services/sdk.ts", realSdk],
  ["../../src/services/pools.ts", realPools],
  ["../../src/services/asp.ts", realAsp],
  ["../../src/utils/pool-accounts.ts", realPoolAccounts],
  ["../../src/services/migration.ts", realMigration],
  ["@0xbow/privacy-pools-core-sdk", realSdkPackage],
] as const;

const MAINNET_POOL = {
  symbol: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  scope: 1n,
  decimals: 18,
  deploymentBlock: 1n,
  minimumDepositAmount: 10000000000000000n,
  vettingFeeBPS: 100n,
  maxRelayFeeBPS: 300n,
};

const OPTIMISM_POOL = {
  ...MAINNET_POOL,
  symbol: "USDC",
  pool: "0x2222222222222222222222222222222222222222",
  asset: "0x3333333333333333333333333333333333333333",
  scope: 2n,
  decimals: 6,
};

const DECLINED_LEGACY_POOL_ACCOUNT = {
  label: 303n,
  deposit: {
    hash: 303n,
    label: 303n,
    value: 700000000000000000n,
    blockNumber: 130n,
    txHash: "0x" + "cc".repeat(32),
  },
  children: [],
  ragequit: undefined,
  isMigrated: false,
};

const initializeAccountServiceWithStateMock = mock(async () => ({
  accountService: {
    account: { poolAccounts: new Map() },
    getSpendableCommitments: () => new Map(),
  },
  skipImmediateSync: false,
  rebuiltLegacyAccount: false,
}));
const syncAccountEventsMock = mock(async () => false);
const withSuppressedSdkStdoutSyncMock = mock(<T>(fn: () => T): T => fn());
const withSuppressedSdkStdoutMock = mock(async <T>(fn: () => Promise<T>): Promise<T> => await fn());
const getDataServiceMock = mock(async () => ({}));
const getPublicClientMock = mock(() => ({
  getBlockNumber: async () => 12_345n,
}));
const listPoolsMock = mock(async () => [MAINNET_POOL]);
const resolvePoolMock = mock(async () => MAINNET_POOL);
const listKnownPoolsFromRegistryMock = mock(async (chainConfig: { id: number }) =>
  chainConfig.id === 10 ? [OPTIMISM_POOL] : [MAINNET_POOL],
);
const loadAspDepositReviewStateMock = mock(async () => ({
  approvedLabels: new Set<string>(["101"]),
  reviewStatuses: new Map<string, string>([
    ["101", "approved"],
    ["102", "pending"],
  ]),
  rawReviewStatuses: new Map<string, string>([
    ["101", "approved"],
    ["102", "pending"],
  ]),
  hasIncompleteReviewData: false,
}));
const buildAllPoolAccountRefsMock = mock(() => [
  {
    paNumber: 1,
    paId: "PA-1",
    status: "approved",
    aspStatus: "approved",
    commitment: {
      hash: 201n,
      label: 101n,
      value: 900000000000000000n,
    },
    label: 101n,
    value: 900000000000000000n,
    blockNumber: 123n,
    txHash: "0x" + "aa".repeat(32),
  },
  {
    paNumber: 2,
    paId: "PA-2",
    status: "pending",
    aspStatus: "pending",
    commitment: {
      hash: 202n,
      label: 102n,
      value: 400000000000000000n,
    },
    label: 102n,
    value: 400000000000000000n,
    blockNumber: 124n,
    txHash: "0x" + "bb".repeat(32),
  },
]);
const collectActiveLabelsMock = mock(() => ["101", "102"]);
const buildMigrationChainReadinessFromLegacyAccountMock = mock(async () => ({
  status: "migration_required",
  candidateLegacyCommitments: 2,
  expectedLegacyCommitments: 1,
  migratedCommitments: 0,
  legacyMasterSeedNullifiedCount: 0,
  hasPostMigrationCommitments: false,
  isMigrated: false,
  legacySpendableCommitments: 1,
  upgradedSpendableCommitments: 0,
  declinedLegacyCommitments: 0,
  reviewStatusComplete: true,
  requiresMigration: true,
  requiresWebsiteRecovery: false,
  scopes: ["1"],
}));
const initializeWithEventsMock = mock(async () => ({
  legacyAccount: { poolAccounts: new Map() },
  errors: [],
}));

let handleAccountsCommand: typeof import("../../src/commands/accounts.ts").handleAccountsCommand;
let handleHistoryCommand: typeof import("../../src/commands/history.ts").handleHistoryCommand;
let handleSyncCommand: typeof import("../../src/commands/sync.ts").handleSyncCommand;
let handleMigrateStatusCommand: typeof import("../../src/commands/migrate.ts").handleMigrateStatusCommand;
let world: TestWorld;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function fakeNestedCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      parent: {
        opts: () => globalOpts,
      },
    },
  } as unknown as Command;
}

function useIsolatedHome(defaultChain: string = "mainnet"): string {
  return world.seedConfigHome({
    defaultChain,
  });
}

async function loadReadonlyHandlers(): Promise<void> {
  installModuleMocks([
    ["../../src/services/account.ts", () => ({
      ...realAccount,
      initializeAccountServiceWithState: initializeAccountServiceWithStateMock,
      syncAccountEvents: syncAccountEventsMock,
      withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
      withSuppressedSdkStdout: withSuppressedSdkStdoutMock,
    })],
    ["../../src/services/sdk.ts", () => ({
      ...realSdk,
      getDataService: getDataServiceMock,
      getPublicClient: getPublicClientMock,
    })],
    ["../../src/services/pools.ts", () => ({
      ...realPools,
      listPools: listPoolsMock,
      resolvePool: resolvePoolMock,
      listKnownPoolsFromRegistry: listKnownPoolsFromRegistryMock,
    })],
    ["../../src/services/asp.ts", () => ({
      loadAspDepositReviewState: loadAspDepositReviewStateMock,
      formatIncompleteAspReviewDataMessage: () =>
        "ASP review data is incomplete.",
      hasIncompleteDepositReviewData: () => false,
    })],
    ["../../src/utils/pool-accounts.ts", () => ({
      ...realPoolAccounts,
      buildAllPoolAccountRefs: buildAllPoolAccountRefsMock,
      collectActiveLabels: collectActiveLabelsMock,
    })],
    ["../../src/services/migration.ts", () => ({
      buildMigrationChainReadinessFromLegacyAccount:
        buildMigrationChainReadinessFromLegacyAccountMock,
    })],
    ["@0xbow/privacy-pools-core-sdk", () => ({
      ...realSdkPackage,
      AccountService: {
        initializeWithEvents: initializeWithEventsMock,
      },
    })],
  ]);

  ({ handleAccountsCommand } = await import(
    "../../src/commands/accounts.ts"
  ));
  ({ handleHistoryCommand } = await import(
    "../../src/commands/history.ts"
  ));
  ({ handleSyncCommand } = await import(
    "../../src/commands/sync.ts"
  ));
  ({ handleMigrateStatusCommand } = await import(
    "../../src/commands/migrate.ts"
  ));
}

afterEach(() => {
  restoreModuleImplementations(READONLY_HANDLER_MODULE_RESTORES);
});

export function registerAccountReadonlyCommandHandlerHarness(): void {
  beforeEach(() => {
    world = createTestWorld({ prefix: "pp-account-readonly-handler-" });
    mock.restore();
    initializeAccountServiceWithStateMock.mockImplementation(async () => ({
      accountService: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () =>
          new Map([
            [
              1n,
              [
                {
                  hash: 201n,
                  label: 101n,
                  value: 900000000000000000n,
                  blockNumber: 123n,
                  txHash: "0x" + "aa".repeat(32),
                },
                {
                  hash: 202n,
                  label: 102n,
                  value: 400000000000000000n,
                  blockNumber: 124n,
                  txHash: "0x" + "bb".repeat(32),
                },
              ],
            ],
          ]),
      },
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
    }));
    syncAccountEventsMock.mockImplementation(async () => false);
    listPoolsMock.mockImplementation(async () => [MAINNET_POOL]);
    resolvePoolMock.mockImplementation(async () => MAINNET_POOL);
    listKnownPoolsFromRegistryMock.mockImplementation(
      async (chainConfig: { id: number }) =>
        chainConfig.id === 10 ? [OPTIMISM_POOL] : [MAINNET_POOL],
    );
    loadAspDepositReviewStateMock.mockImplementation(async () => ({
      approvedLabels: new Set<string>(["101"]),
      reviewStatuses: new Map<string, string>([
        ["101", "approved"],
        ["102", "pending"],
      ]),
      rawReviewStatuses: new Map<string, string>([
        ["101", "approved"],
        ["102", "pending"],
      ]),
      hasIncompleteReviewData: false,
    }));
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      {
        paNumber: 1,
        paId: "PA-1",
        status: "approved",
        aspStatus: "approved",
        commitment: { hash: 201n, label: 101n, value: 900000000000000000n },
        label: 101n,
        value: 900000000000000000n,
        blockNumber: 123n,
        txHash: "0x" + "aa".repeat(32),
      },
      {
        paNumber: 2,
        paId: "PA-2",
        status: "pending",
        aspStatus: "pending",
        commitment: { hash: 202n, label: 102n, value: 400000000000000000n },
        label: 102n,
        value: 400000000000000000n,
        blockNumber: 124n,
        txHash: "0x" + "bb".repeat(32),
      },
    ]);
    collectActiveLabelsMock.mockImplementation(() => ["101", "102"]);
    buildMigrationChainReadinessFromLegacyAccountMock.mockImplementation(
      async () => ({
        status: "migration_required",
        candidateLegacyCommitments: 2,
        expectedLegacyCommitments: 1,
        migratedCommitments: 0,
        legacyMasterSeedNullifiedCount: 0,
        hasPostMigrationCommitments: false,
        isMigrated: false,
        legacySpendableCommitments: 1,
        upgradedSpendableCommitments: 0,
        declinedLegacyCommitments: 0,
        reviewStatusComplete: true,
        requiresMigration: true,
        requiresWebsiteRecovery: false,
        scopes: ["1"],
      }),
    );
    initializeWithEventsMock.mockImplementation(async () => ({
      legacyAccount: { poolAccounts: new Map() },
      errors: [],
    }));
  });

  beforeEach(async () => {
    await loadReadonlyHandlers();
  });

  afterEach(async () => {
    await world?.teardown();
  });
}

export function registerReadonlyAccountsTests(): void {
  test("accounts rejects incompatible compact mode flags", async () => {
    useIsolatedHome("mainnet");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { summary: true, pendingOnly: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Cannot specify both --summary and --pending-only",
    );
    expect(exitCode).toBe(2);
  });

  test("accounts rejects --rpc-url in multi-chain mode", async () => {
    useIsolatedHome("mainnet");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        {},
        fakeCommand({ json: true, rpcUrl: "https://rpc.example" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "--rpc-url cannot be combined with multi-chain accounts queries",
    );
    expect(exitCode).toBe(2);
  });

  test("accounts rejects --details when using compact summary mode", async () => {
    useIsolatedHome("mainnet");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { summary: true, details: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Compact account modes do not support --details",
    );
    expect(exitCode).toBe(2);
  });

  test("accounts returns balances, pending count, and poll guidance in JSON mode", async () => {
    useIsolatedHome("mainnet");

    const { json } = await captureAsyncJsonOutput(() =>
      handleAccountsCommand({}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.accounts).toHaveLength(2);
    expect(json.balances).toEqual([
      expect.objectContaining({
        asset: "ETH",
        balance: "1300000000000000000",
        poolAccounts: 2,
      }),
    ]);
    expect(json.pendingCount).toBe(1);
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "accounts",
          when: "has_pending",
        }),
      ]),
    );
  });

  test("accounts summary and pending-only modes route through the compact JSON variants", async () => {
    useIsolatedHome("mainnet");

    const summary = await captureAsyncJsonOutput(() =>
      handleAccountsCommand(
        { summary: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );
    const pendingOnly = await captureAsyncJsonOutput(() =>
      handleAccountsCommand(
        { pendingOnly: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(summary.json.success).toBe(true);
    expect(summary.json.approvedCount).toBe(1);
    expect(summary.json.pendingCount).toBe(1);
    expect(pendingOnly.json.success).toBe(true);
    expect(pendingOnly.json.accounts).toHaveLength(1);
    expect(pendingOnly.json.accounts[0].poolAccountId).toBe("PA-2");
  });

  test("accounts renders an empty JSON payload when pool discovery returns no pools", async () => {
    useIsolatedHome("mainnet");
    listPoolsMock.mockImplementationOnce(async () => []);

    const { json } = await captureAsyncJsonOutput(() =>
      handleAccountsCommand(
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.accounts).toEqual([]);
    expect(json.balances).toEqual([]);
    expect(json.pendingCount).toBe(0);
  });

  test("accounts includes declined legacy Pool Accounts when website recovery visibility is available", async () => {
    useIsolatedHome("mainnet");
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);
    collectActiveLabelsMock.mockImplementationOnce(() => []);
    loadAspDepositReviewStateMock.mockImplementationOnce(async () => ({
      approvedLabels: new Set<string>(),
      reviewStatuses: new Map<string, string>(),
      rawReviewStatuses: new Map<string, string>(),
      hasIncompleteReviewData: false,
    }));
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => ({
      accountService: {
        account: {
          poolAccounts: new Map(),
          __legacyPoolAccounts: new Map([[1n, [DECLINED_LEGACY_POOL_ACCOUNT]]]),
        },
        getSpendableCommitments: () => new Map(),
      },
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
      legacyDeclinedLabels: new Set(["303"]),
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleAccountsCommand({}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "declined",
          aspStatus: "declined",
          poolAccountId: "PA-1",
          label: "303",
          value: "700000000000000000",
        }),
      ]),
    );
  });

  test("accounts surfaces partial ASP review warnings for successful single-chain loads", async () => {
    useIsolatedHome("mainnet");
    loadAspDepositReviewStateMock.mockImplementationOnce(async () => ({
      approvedLabels: new Set<string>(["101"]),
      reviewStatuses: new Map<string, string>([["101", "approved"]]),
      rawReviewStatuses: new Map<string, string>([["101", "approved"]]),
      hasIncompleteReviewData: true,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleAccountsCommand({}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chain: "mainnet",
          category: "ASP",
        }),
      ]),
    );
  });

  test("accounts fails closed when every queried chain errors", async () => {
    useIsolatedHome("mainnet");
    initializeAccountServiceWithStateMock.mockImplementation(async () => {
      throw new Error("rpc unavailable");
    });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNKNOWN_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("rpc unavailable");
    expect(exitCode).toBe(1);
  });

  test("accounts explicit single-chain failures route through the sequential error path", async () => {
    useIsolatedHome("mainnet");
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => {
      throw new Error("mainnet rpc unavailable");
    });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand({}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain("mainnet rpc unavailable");
    expect(exitCode).toBe(1);
  });

  test("accounts keeps partial multi-chain warnings while returning successful results", async () => {
    useIsolatedHome("mainnet");
    initializeAccountServiceWithStateMock.mockImplementation(
      async (
        _dataService: unknown,
        _mnemonic: unknown,
        poolInfos: Array<{ chainId: number }>,
      ) => {
        if (poolInfos[0]?.chainId === 10) {
          throw new Error("optimism rpc unavailable");
        }
        return {
          accountService: {
            account: { poolAccounts: new Map() },
            getSpendableCommitments: () =>
              new Map([
                [
                  1n,
                  [
                    {
                      hash: 201n,
                      label: 101n,
                      value: 900000000000000000n,
                      blockNumber: 123n,
                      txHash: "0x" + "aa".repeat(32),
                    },
                    {
                      hash: 202n,
                      label: 102n,
                      value: 400000000000000000n,
                      blockNumber: 124n,
                      txHash: "0x" + "bb".repeat(32),
                    },
                  ],
                ],
              ]),
          },
          skipImmediateSync: false,
          rebuiltLegacyAccount: false,
        };
      },
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleAccountsCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.chain).toBe("all-mainnets");
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chain: "optimism",
          category: "UNKNOWN",
        }),
      ]),
    );
    expect(json.chains).toEqual(
      expect.arrayContaining(["mainnet", "arbitrum", "optimism"]),
    );
    expect(json.accounts.length).toBeGreaterThan(0);
  });

}

export function registerReadonlyHistoryTests(): void {
  test("history returns newest events first and honors the limit", async () => {
    useIsolatedHome("mainnet");

    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => ({
      accountService: {
        account: {
          poolAccounts: new Map([
            [
              1n,
              [
                {
                  deposit: {
                    value: 900000000000000000n,
                    blockNumber: 100n,
                    txHash: "0x" + "11".repeat(32),
                  },
                  children: [
                    {
                      value: 400000000000000000n,
                      blockNumber: 150n,
                      txHash: "0x" + "22".repeat(32),
                    },
                  ],
                  ragequit: {
                    value: 500000000000000000n,
                    blockNumber: 200n,
                    transactionHash: "0x" + "33".repeat(32),
                  },
                },
              ],
            ],
          ]),
        },
      },
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleHistoryCommand({ limit: "2" }, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.events).toHaveLength(2);
    expect(json.events[0]).toEqual(
      expect.objectContaining({
        type: "ragequit",
        poolAccountId: "PA-1",
      }),
    );
    expect(json.events[1]).toEqual(
      expect.objectContaining({
        type: "withdrawal",
        poolAccountId: "PA-1",
      }),
    );
  });

  test("history includes declined legacy deposits when website recovery visibility is available", async () => {
    useIsolatedHome("mainnet");

    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => ({
      accountService: {
        account: {
          poolAccounts: new Map(),
          __legacyPoolAccounts: new Map([[1n, [DECLINED_LEGACY_POOL_ACCOUNT]]]),
        },
      },
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
      legacyDeclinedLabels: new Set(["303"]),
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleHistoryCommand({ limit: "5" }, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deposit",
          poolAccountId: "PA-1",
          value: "700000000000000000",
          txHash: "0x" + "cc".repeat(32),
        }),
      ]),
    );
  });

}

export function registerReadonlySyncTests(): void {
  test("sync reports available Pool Account deltas in JSON mode", async () => {
    useIsolatedHome("mainnet");

    let spendableCount = 1;
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => ({
      accountService: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () =>
          new Map([
            [
              1n,
              Array.from({ length: spendableCount }, (_, index) => ({
                label: BigInt(101 + index),
              })),
            ],
          ]),
      },
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
    }));

    syncAccountEventsMock.mockImplementationOnce(async () => {
      spendableCount = 3;
      return true;
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handleSyncCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.syncedPools).toBe(1);
    expect(json.availablePoolAccounts).toBe(3);
    expect(json.previousAvailablePoolAccounts).toBe(1);
  });

}

export function registerReadonlyMigrateStatusTests(): void {
  test("migrate status reports migration-required readiness on a single chain", async () => {
    useIsolatedHome("mainnet");

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("migration-status");
    expect(json.chain).toBe("mainnet");
    expect(json.status).toBe("migration_required");
    expect(json.requiresMigration).toBe(true);
    expect(json.requiresWebsiteRecovery).toBe(false);
    expect(json.readinessResolved).toBe(true);
    expect(json.chainReadiness).toEqual([
      expect.objectContaining({
        chain: "mainnet",
        status: "migration_required",
        expectedLegacyCommitments: 1,
      }),
    ]);
  });

  test("migrate status reports no_legacy when no legacy commitments remain", async () => {
    useIsolatedHome("mainnet");
    buildMigrationChainReadinessFromLegacyAccountMock.mockImplementationOnce(
      async () => ({
        status: "no_legacy",
        candidateLegacyCommitments: 0,
        expectedLegacyCommitments: 0,
        migratedCommitments: 0,
        legacyMasterSeedNullifiedCount: 0,
        hasPostMigrationCommitments: false,
        isMigrated: false,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 0,
        declinedLegacyCommitments: 0,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        scopes: [],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("no_legacy");
    expect(json.requiresMigration).toBe(false);
    expect(json.requiresWebsiteRecovery).toBe(false);
    expect(json.isFullyMigrated).toBe(true);
    expect(json.requiredChainIds).toEqual([]);
  });

  test("migrate status reports fully_migrated when all known legacy commitments are already migrated", async () => {
    useIsolatedHome("mainnet");
    buildMigrationChainReadinessFromLegacyAccountMock.mockImplementationOnce(
      async () => ({
        status: "fully_migrated",
        candidateLegacyCommitments: 2,
        expectedLegacyCommitments: 2,
        migratedCommitments: 2,
        legacyMasterSeedNullifiedCount: 2,
        hasPostMigrationCommitments: true,
        isMigrated: true,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 2,
        declinedLegacyCommitments: 0,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        scopes: ["1"],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("fully_migrated");
    expect(json.requiresMigration).toBe(false);
    expect(json.requiresWebsiteRecovery).toBe(false);
    expect(json.isFullyMigrated).toBe(true);
    expect(json.migratedChainIds).toContain(1);
  });

  test("migrate status fails closed when one queried chain cannot be loaded", async () => {
    useIsolatedHome("mainnet");

    initializeWithEventsMock.mockImplementation(
      async (_dataService: unknown, _wallet: unknown, poolInfos: Array<{ chainId: number }>) => {
        if (poolInfos[0]?.chainId === 42161) {
          throw new Error("arbitrum rpc down");
        }
        return {
          legacyAccount: { poolAccounts: new Map() },
          errors: [],
        };
      },
    );

    buildMigrationChainReadinessFromLegacyAccountMock.mockImplementation(
      async (_legacyAccount: unknown, chainId: number) => ({
        status: chainId === 1 ? "no_legacy" : "fully_migrated",
        candidateLegacyCommitments: 0,
        expectedLegacyCommitments: 0,
        migratedCommitments: 0,
        legacyMasterSeedNullifiedCount: 0,
        hasPostMigrationCommitments: false,
        isMigrated: chainId !== 1,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 0,
        declinedLegacyCommitments: 0,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        scopes: [],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand({}, fakeNestedCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("review_incomplete");
    expect(json.readinessResolved).toBe(false);
    expect(json.unresolvedChainIds).toContain(42161);
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chain: "arbitrum",
        }),
      ]),
    );
  });

  test("migrate status keeps website-recovery states in the top-level summary", async () => {
    useIsolatedHome("mainnet");

    buildMigrationChainReadinessFromLegacyAccountMock.mockImplementationOnce(
      async () => ({
        status: "website_recovery_required",
        candidateLegacyCommitments: 1,
        expectedLegacyCommitments: 0,
        migratedCommitments: 0,
        legacyMasterSeedNullifiedCount: 0,
        hasPostMigrationCommitments: false,
        isMigrated: false,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 0,
        declinedLegacyCommitments: 1,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: true,
        scopes: ["1"],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("website_recovery_required");
    expect(json.requiresMigration).toBe(false);
    expect(json.requiresWebsiteRecovery).toBe(true);
    expect(json.websiteRecoveryChainIds).toContain(1);
  });

  test("migrate status fails cleanly when the CLI has no supported pools for a queried chain", async () => {
    useIsolatedHome("mainnet");
    listKnownPoolsFromRegistryMock.mockImplementationOnce(async () => []);

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNKNOWN_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No CLI-supported pools are configured",
    );
    expect(json.error.hint).toContain("Privacy Pools website");
    expect(exitCode).toBe(1);
  });

  test("migrate status surfaces retryable RPC errors when legacy initialization is partial", async () => {
    useIsolatedHome("mainnet");
    initializeWithEventsMock.mockImplementationOnce(async () => ({
      legacyAccount: { poolAccounts: new Map() },
      errors: [{ scope: 1n, reason: "rpc unavailable" }],
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.retryable).toBe(true);
    expect(json.error.message ?? json.errorMessage).toContain(
      "Failed to load legacy migration readiness",
    );
    expect(exitCode).toBe(3);
  });
}
