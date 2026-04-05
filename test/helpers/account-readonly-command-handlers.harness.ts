import {
  afterEach,
  beforeEach,
  mock,
} from "bun:test";
import type { Command } from "commander";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "./module-mocks.ts";
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
const ORIGINAL_SDK_INIT_WITH_EVENTS =
  realSdkPackage.AccountService.initializeWithEvents;
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

function createDefaultAspReviewState() {
  return {
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
  };
}

function createDefaultSpendableCommitments() {
  return new Map([
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
  ]);
}

function createDefaultPoolAccountRefs() {
  return [
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
  ];
}

function createDefaultMigrationReadiness() {
  return {
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
  };
}

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
const loadAspDepositReviewStateMock = mock(async () =>
  createDefaultAspReviewState(),
);
const buildAllPoolAccountRefsMock = mock(() => createDefaultPoolAccountRefs());
const collectActiveLabelsMock = mock(() => ["101", "102"]);
const buildMigrationChainReadinessFromLegacyAccountMock = mock(async () =>
  createDefaultMigrationReadiness(),
);
const initializeWithEventsMock = mock(async () => ({
  legacyAccount: { poolAccounts: new Map() },
  errors: [],
}));

let handleAccountsCommand: typeof import("../../src/commands/accounts.ts").handleAccountsCommand;
let handleHistoryCommand: typeof import("../../src/commands/history.ts").handleHistoryCommand;
let handleSyncCommand: typeof import("../../src/commands/sync.ts").handleSyncCommand;
let handleMigrateStatusCommand: typeof import("../../src/commands/migrate.ts").handleMigrateStatusCommand;
let world: TestWorld;

export function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

export function fakeNestedCommand(
  globalOpts: Record<string, unknown> = {},
): Command {
  return {
    parent: {
      parent: {
        opts: () => globalOpts,
      },
    },
  } as unknown as Command;
}

export function useIsolatedHome(defaultChain: string = "mainnet"): string {
  return world.seedConfigHome({
    defaultChain,
  });
}

async function loadReadonlyHandlers(): Promise<void> {
  realSdkPackage.AccountService.initializeWithEvents =
    initializeWithEventsMock as typeof realSdkPackage.AccountService.initializeWithEvents;

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
  realSdkPackage.AccountService.initializeWithEvents =
    ORIGINAL_SDK_INIT_WITH_EVENTS;
});

export function registerAccountReadonlyCommandHandlerHarness(): void {
  beforeEach(() => {
    world = createTestWorld({ prefix: "pp-account-readonly-handler-" });
    mock.restore();
    initializeAccountServiceWithStateMock.mockImplementation(async () => ({
      accountService: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => createDefaultSpendableCommitments(),
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
    loadAspDepositReviewStateMock.mockImplementation(async () =>
      createDefaultAspReviewState(),
    );
    buildAllPoolAccountRefsMock.mockImplementation(() =>
      createDefaultPoolAccountRefs(),
    );
    collectActiveLabelsMock.mockImplementation(() => ["101", "102"]);
    buildMigrationChainReadinessFromLegacyAccountMock.mockImplementation(
      async () => createDefaultMigrationReadiness(),
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

export interface ReadonlyCommandHandlers {
  handleAccountsCommand: typeof import("../../src/commands/accounts.ts").handleAccountsCommand;
  handleHistoryCommand: typeof import("../../src/commands/history.ts").handleHistoryCommand;
  handleSyncCommand: typeof import("../../src/commands/sync.ts").handleSyncCommand;
  handleMigrateStatusCommand: typeof import("../../src/commands/migrate.ts").handleMigrateStatusCommand;
}

export function getReadonlyCommandHandlers(): ReadonlyCommandHandlers {
  if (
    !handleAccountsCommand
    || !handleHistoryCommand
    || !handleSyncCommand
    || !handleMigrateStatusCommand
  ) {
    throw new Error("Readonly command handlers have not been loaded yet.");
  }

  return {
    handleAccountsCommand,
    handleHistoryCommand,
    handleSyncCommand,
    handleMigrateStatusCommand,
  };
}

export const readonlyHarnessMocks = {
  initializeAccountServiceWithStateMock,
  syncAccountEventsMock,
  listPoolsMock,
  resolvePoolMock,
  listKnownPoolsFromRegistryMock,
  loadAspDepositReviewStateMock,
  buildAllPoolAccountRefsMock,
  collectActiveLabelsMock,
  buildMigrationChainReadinessFromLegacyAccountMock,
  initializeWithEventsMock,
};

export { DECLINED_LEGACY_POOL_ACCOUNT };
