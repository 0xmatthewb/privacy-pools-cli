import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realErrors = captureModuleExports(
  await import("../../src/utils/errors.ts"),
);
const realMode = captureModuleExports(await import("../../src/utils/mode.ts"));
const realAccount = captureModuleExports(
  await import("../../src/services/account.ts"),
);
const realAsp = captureModuleExports(await import("../../src/services/asp.ts"));
const realConfig = captureModuleExports(
  await import("../../src/services/config.ts"),
);
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realWallet = captureModuleExports(
  await import("../../src/services/wallet.ts"),
);
const realValidation = captureModuleExports(
  await import("../../src/utils/validation.ts"),
);
const realFormat = captureModuleExports(
  await import("../../src/utils/format.ts"),
);
const realProofProgress = captureModuleExports(
  await import("../../src/utils/proof-progress.ts"),
);
const realOutputCommon = captureModuleExports(
  await import("../../src/output/common.ts"),
);
const realAccountsOutput = captureModuleExports(
  await import("../../src/output/accounts.ts"),
);
const realHistoryOutput = captureModuleExports(
  await import("../../src/output/history.ts"),
);
const realSyncOutput = captureModuleExports(
  await import("../../src/output/sync.ts"),
);

const ACCOUNT_ERROR_MODULE_RESTORES = [
  ["../../src/utils/validation.ts", realValidation],
  ["../../src/services/config.ts", realConfig],
  ["../../src/services/wallet.ts", realWallet],
  ["../../src/services/sdk.ts", realSdk],
  ["../../src/services/pools.ts", realPools],
  ["../../src/services/account.ts", realAccount],
  ["../../src/services/asp.ts", realAsp],
  ["../../src/utils/format.ts", realFormat],
  ["../../src/utils/proof-progress.ts", realProofProgress],
  ["../../src/output/common.ts", realOutputCommon],
  ["../../src/output/accounts.ts", realAccountsOutput],
  ["../../src/output/history.ts", realHistoryOutput],
  ["../../src/output/sync.ts", realSyncOutput],
  ["../../src/utils/errors.ts", realErrors],
  ["../../src/utils/mode.ts", realMode],
] as const;

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

async function loadAccountErrorHandlers(): Promise<void> {
  installModuleMocks([
    ["../../src/utils/validation.ts", () => ({
      resolveChain: () => chainConfig,
    })],
    ["../../src/services/config.ts", () => ({
      loadConfig: () => config,
    })],
    ["../../src/services/wallet.ts", () => ({
      ...realWallet,
      loadMnemonic: () =>
        "test test test test test test test test test test test junk",
    })],
    ["../../src/services/sdk.ts", () => ({
      ...realSdk,
      getDataService: async () => ({}),
      getPublicClient: () => ({
        getTransactionReceipt: async () => null,
      }),
    })],
    ["../../src/services/pools.ts", () => ({
      ...realPools,
      listPools: async () => [pool],
      resolvePool: async () => pool,
    })],
    ["../../src/services/account.ts", () => ({
      ...realAccount,
      initializeAccountServiceWithState: initializeAccountServiceWithStateMock,
      syncAccountEvents: syncAccountEventsMock,
      withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
    })],
    ["../../src/services/asp.ts", () => ({
      ...realAsp,
      formatIncompleteAspReviewDataMessage: () => "",
      hasIncompleteDepositReviewData: () => false,
      loadAspDepositReviewState: async () => ({
        approvedLabels: new Set<string>(),
        reviewStatuses: new Map<string, string>(),
        hasIncompleteReviewData: false,
      }),
    })],
    ["../../src/utils/format.ts", () => ({
      spinner: spinnerMock,
      verbose: verboseMock,
      deriveTokenPrice: deriveTokenPriceMock,
    })],
    ["../../src/utils/proof-progress.ts", () => ({
      withSpinnerProgress: withSpinnerProgressMock,
    })],
    ["../../src/output/common.ts", () => ({
      ...realOutputCommon,
      createOutputContext: createOutputContextMock,
      isSilent: () => true,
    })],
    ["../../src/output/accounts.ts", () => ({
      renderAccountsNoPools: renderAccountsNoPoolsMock,
      renderAccounts: renderAccountsMock,
    })],
    ["../../src/output/history.ts", () => ({
      renderHistoryNoPools: renderHistoryNoPoolsMock,
      renderHistory: renderHistoryMock,
    })],
    ["../../src/output/sync.ts", () => ({
      renderSyncEmpty: renderSyncEmptyMock,
      renderSyncComplete: renderSyncCompleteMock,
    })],
    ["../../src/utils/errors.ts", () => ({
      ...realErrors,
      printError: printErrorMock,
    })],
    ["../../src/utils/mode.ts", () => ({
      ...realMode,
      resolveGlobalMode: resolveGlobalModeMock,
    })],
  ]);

  ({ handleAccountsCommand } = await import(
    `../../src/commands/accounts.ts?account-handler-errors=${Date.now()}`
  ));
  ({ handleHistoryCommand } = await import(
    `../../src/commands/history.ts?account-handler-errors=${Date.now()}`
  ));
  ({ handleSyncCommand } = await import(
    `../../src/commands/sync.ts?account-handler-errors=${Date.now()}`
  ));
}

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

afterEach(() => {
  restoreModuleImplementations(ACCOUNT_ERROR_MODULE_RESTORES);
});

describe("account command error boundaries", () => {
  beforeEach(async () => {
    mock.restore();
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

    await loadAccountErrorHandlers();
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

  test("accounts prints ACCOUNT_MIGRATION_REVIEW_INCOMPLETE in JSON mode", async () => {
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => {
      throw realErrors.accountMigrationReviewIncompleteError();
    });

    await handleAccountsCommand({}, fakeCommand({ json: true, chain: "sepolia" }));

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
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

  test("sync prints RPC error and skips success rendering when event sync fails", async () => {
    syncAccountEventsMock.mockImplementationOnce(async () => {
      throw new realErrors.CLIError(
        "Sync sync failed for 1 pool(s).",
        "RPC",
        "Retry with a healthy RPC before using this data.",
        "RPC_ERROR",
        true,
      );
    });

    await handleSyncCommand({}, fakeCommand({ chain: "sepolia" }));

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    expect(renderSyncCompleteMock).not.toHaveBeenCalled();
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
