import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";

const realErrors = await import("../../src/utils/errors.ts");
const realMode = await import("../../src/utils/mode.ts");
const realAccount = await import("../../src/services/account.ts");
const realAsp = await import("../../src/services/asp.ts");

const chainConfig = {
  id: 11155111,
  name: "sepolia",
  startBlock: 1n,
  aspHost: "https://dw.0xbow.io",
  relayerHost: "https://testnet-relayer.privacypools.com",
  isTestnet: true,
  avgBlockTimeSec: 12,
  entrypoint: "0x1111111111111111111111111111111111111111",
  chain: {} as Record<string, never>,
};

const config = {
  defaultChain: "sepolia",
  rpcOverrides: {},
};

const pool = {
  symbol: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  scope: 1n,
  deploymentBlock: 1n,
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
const resolveGlobalModeMock = mock((globalOpts: Record<string, unknown> = {}) => ({
  isAgent: Boolean(globalOpts.agent),
  isJson: Boolean(globalOpts.json),
  isCsv: false,
  isQuiet: Boolean(globalOpts.quiet),
  format: "json",
  skipPrompts: true,
}));
const createOutputContextMock = mock(() => ({}));
const printErrorMock = mock(() => undefined);
const renderAccountsNoPoolsMock = mock(() => undefined);
const renderAccountsMock = mock(() => undefined);
const renderHistoryNoPoolsMock = mock(() => undefined);
const renderHistoryMock = mock(() => undefined);
const renderSyncEmptyMock = mock(() => undefined);
const renderSyncCompleteMock = mock(() => undefined);
const spinnerMock = mock(() => ({
  start: mock(() => undefined),
  stop: mock(() => undefined),
  succeed: mock(() => undefined),
  text: "",
}));
const verboseMock = mock(() => undefined);
const deriveTokenPriceMock = mock(() => null);
const withSpinnerProgressMock = mock(
  async (_spin: unknown, _label: string, fn: () => Promise<unknown>) => await fn(),
);

let handleAccountsCommand: typeof import("../../src/commands/accounts.ts").handleAccountsCommand;
let handleHistoryCommand: typeof import("../../src/commands/history.ts").handleHistoryCommand;
let handleSyncCommand: typeof import("../../src/commands/sync.ts").handleSyncCommand;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function clearMockCalls(fn: {
  mock?: {
    calls?: unknown[];
    results?: unknown[];
    contexts?: unknown[];
    instances?: unknown[];
  };
}): void {
  fn.mock?.calls?.splice(0);
  fn.mock?.results?.splice(0);
  fn.mock?.contexts?.splice(0);
  fn.mock?.instances?.splice(0);
}

beforeAll(async () => {
  mock.module("../../src/utils/validation.ts", () => ({
    resolveChain: () => chainConfig,
  }));
  mock.module("../../src/services/config.ts", () => ({
    loadConfig: () => config,
  }));
  mock.module("../../src/services/wallet.ts", () => ({
    loadMnemonic: () => "test test test test test test test test test test test junk",
  }));
  mock.module("../../src/services/sdk.ts", () => ({
    getDataService: async () => ({}),
    getPublicClient: () => ({
      getTransactionReceipt: async () => null,
    }),
  }));
  mock.module("../../src/services/pools.ts", () => ({
    listPools: async () => [pool],
    resolvePool: async () => pool,
  }));
  mock.module("../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountServiceWithState: initializeAccountServiceWithStateMock,
    syncAccountEvents: syncAccountEventsMock,
    withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
  }));
  mock.module("../../src/services/asp.ts", () => ({
    ...realAsp,
    formatIncompleteAspReviewDataMessage: () => "",
    hasIncompleteDepositReviewData: () => false,
    loadAspDepositReviewState: async () => ({
      approvedLabels: new Set<string>(),
      reviewStatuses: new Map<string, string>(),
      hasIncompleteReviewData: false,
    }),
  }));
  mock.module("../../src/utils/format.ts", () => ({
    spinner: spinnerMock,
    verbose: verboseMock,
    deriveTokenPrice: deriveTokenPriceMock,
  }));
  mock.module("../../src/utils/proof-progress.ts", () => ({
    withSpinnerProgress: withSpinnerProgressMock,
  }));
  mock.module("../../src/output/common.ts", () => ({
    createOutputContext: createOutputContextMock,
    isSilent: () => true,
  }));
  mock.module("../../src/output/accounts.ts", () => ({
    renderAccountsNoPools: renderAccountsNoPoolsMock,
    renderAccounts: renderAccountsMock,
  }));
  mock.module("../../src/output/history.ts", () => ({
    renderHistoryNoPools: renderHistoryNoPoolsMock,
    renderHistory: renderHistoryMock,
  }));
  mock.module("../../src/output/sync.ts", () => ({
    renderSyncEmpty: renderSyncEmptyMock,
    renderSyncComplete: renderSyncCompleteMock,
  }));
  mock.module("../../src/utils/errors.ts", () => ({
    ...realErrors,
    printError: printErrorMock,
  }));
  mock.module("../../src/utils/mode.ts", () => ({
    ...realMode,
    resolveGlobalMode: resolveGlobalModeMock,
  }));

  ({ handleAccountsCommand } = await import("../../src/commands/accounts.ts?account-handler-errors"));
  ({ handleHistoryCommand } = await import("../../src/commands/history.ts?account-handler-errors"));
  ({ handleSyncCommand } = await import("../../src/commands/sync.ts?account-handler-errors"));
});

afterAll(() => {
  mock.restore();
});

describe("account command error boundaries", () => {
  beforeEach(() => {
    clearMockCalls(initializeAccountServiceWithStateMock);
    clearMockCalls(syncAccountEventsMock);
    clearMockCalls(withSuppressedSdkStdoutSyncMock);
    clearMockCalls(resolveGlobalModeMock);
    clearMockCalls(createOutputContextMock);
    clearMockCalls(printErrorMock);
    clearMockCalls(renderAccountsNoPoolsMock);
    clearMockCalls(renderAccountsMock);
    clearMockCalls(renderHistoryNoPoolsMock);
    clearMockCalls(renderHistoryMock);
    clearMockCalls(renderSyncEmptyMock);
    clearMockCalls(renderSyncCompleteMock);
    clearMockCalls(spinnerMock);
    clearMockCalls(verboseMock);
    clearMockCalls(deriveTokenPriceMock);
    clearMockCalls(withSpinnerProgressMock);

    initializeAccountServiceWithStateMock.mockImplementation(async () => ({
      accountService: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
    }));
    syncAccountEventsMock.mockImplementation(async () => false);
  });

  test("accounts prints ACCOUNT_MIGRATION_REQUIRED in JSON mode", async () => {
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => {
      throw realErrors.accountMigrationRequiredError();
    });

    await handleAccountsCommand({}, fakeCommand({ json: true, chain: "sepolia" }));

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "ACCOUNT_MIGRATION_REQUIRED",
    );
    expect(isJson).toBe(true);
  });

  test("history prints ACCOUNT_MIGRATION_REQUIRED in JSON mode", async () => {
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => {
      throw realErrors.accountMigrationRequiredError();
    });

    await handleHistoryCommand({}, fakeCommand({ json: true, chain: "sepolia" }));

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "ACCOUNT_MIGRATION_REQUIRED",
    );
    expect(isJson).toBe(true);
  });

  test("accounts prints ACCOUNT_WEBSITE_RECOVERY_REQUIRED in JSON mode", async () => {
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => {
      throw realErrors.accountWebsiteRecoveryRequiredError();
    });

    await handleAccountsCommand({}, fakeCommand({ json: true, chain: "sepolia" }));

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    );
    expect(isJson).toBe(true);
  });

  test("sync prints ACCOUNT_MIGRATION_REQUIRED in JSON mode", async () => {
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => {
      throw realErrors.accountMigrationRequiredError();
    });

    await handleSyncCommand({}, fakeCommand({ json: true, chain: "sepolia" }));

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "ACCOUNT_MIGRATION_REQUIRED",
    );
    expect(isJson).toBe(true);
  });

  test("sync requests strict initialization before running event sync", async () => {
    await handleSyncCommand({}, fakeCommand({ json: true, chain: "sepolia" }));

    expect(initializeAccountServiceWithStateMock).toHaveBeenCalledTimes(1);
    expect(initializeAccountServiceWithStateMock).toHaveBeenCalledWith(
      {},
      "test test test test test test test test test test test junk",
      [
        {
          chainId: 11155111,
          address: pool.pool,
          scope: pool.scope,
          deploymentBlock: pool.deploymentBlock,
        },
      ],
      11155111,
      expect.objectContaining({
        allowLegacyAccountRebuild: true,
        strictSync: true,
      }),
    );
    expect(syncAccountEventsMock).toHaveBeenCalledTimes(1);
    expect(renderSyncCompleteMock).toHaveBeenCalledTimes(1);
  });
});
