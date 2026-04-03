import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import { captureAsyncOutput } from "../helpers/output.ts";

const realConfig = captureModuleExports(
  await import("../../src/services/config.ts"),
);
const realWallet = captureModuleExports(
  await import("../../src/services/wallet.ts"),
);
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realAccount = captureModuleExports(
  await import("../../src/services/account.ts"),
);
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realHistoryOutput = captureModuleExports(
  await import("../../src/output/history.ts"),
);
const realErrors = captureModuleExports(
  await import("../../src/utils/errors.ts"),
);

const HISTORY_HANDLER_RESTORES = [
  ["../../src/services/config.ts", realConfig],
  ["../../src/services/wallet.ts", realWallet],
  ["../../src/services/sdk.ts", realSdk],
  ["../../src/services/account.ts", realAccount],
  ["../../src/services/pools.ts", realPools],
  ["../../src/output/history.ts", realHistoryOutput],
  ["../../src/utils/errors.ts", realErrors],
] as const;

const loadConfigMock = mock(() => ({
  defaultChain: "mainnet",
  rpcOverrides: {},
}));
const loadMnemonicMock = mock(() =>
  "test test test test test test test test test test test junk",
);
const listPoolsMock = mock(async () => [
  {
    symbol: "ETH",
    pool: "0x1111111111111111111111111111111111111111",
    scope: 1n,
    decimals: 18,
    deploymentBlock: 1n,
  },
]);
const getDataServiceMock = mock(async () => ({}));
const initializeAccountServiceWithStateMock = mock(async () => ({
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
                value: 400000000000000000n,
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
}));
const syncAccountEventsMock = mock(async () => false);
const getPublicClientMock = mock(() => ({
  getBlockNumber: async () => 250n,
}));
const renderHistoryMock = mock(() => undefined);
const renderHistoryNoPoolsMock = mock(() => undefined);
const printErrorMock = mock(() => undefined);

let handleHistoryCommand: typeof import("../../src/commands/history.ts").handleHistoryCommand;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

async function loadHistoryCommand(): Promise<void> {
  mock.module("../../src/services/config.ts", () => ({
    ...realConfig,
    loadConfig: loadConfigMock,
  }));
  mock.module("../../src/services/wallet.ts", () => ({
    ...realWallet,
    loadMnemonic: loadMnemonicMock,
  }));
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getDataService: getDataServiceMock,
    getPublicClient: getPublicClientMock,
  }));
  mock.module("../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountServiceWithState: initializeAccountServiceWithStateMock,
    syncAccountEvents: syncAccountEventsMock,
  }));
  mock.module("../../src/services/pools.ts", () => ({
    ...realPools,
    listPools: listPoolsMock,
  }));
  mock.module("../../src/output/history.ts", () => ({
    ...realHistoryOutput,
    renderHistory: renderHistoryMock,
    renderHistoryNoPools: renderHistoryNoPoolsMock,
  }));
  mock.module("../../src/utils/errors.ts", () => ({
    ...realErrors,
    printError: printErrorMock,
  }));

  ({ handleHistoryCommand } = await import(
    "../../src/commands/history.ts"
  ));
}

beforeEach(async () => {
  mock.restore();
  loadConfigMock.mockClear();
  loadMnemonicMock.mockClear();
  listPoolsMock.mockClear();
  getDataServiceMock.mockClear();
  initializeAccountServiceWithStateMock.mockClear();
  syncAccountEventsMock.mockClear();
  getPublicClientMock.mockClear();
  renderHistoryMock.mockClear();
  renderHistoryNoPoolsMock.mockClear();
  printErrorMock.mockClear();
  await loadHistoryCommand();
});

afterEach(() => {
  restoreModuleImplementations(HISTORY_HANDLER_RESTORES);
});

describe("history command handler", () => {
  test("renders newest events first and honors the limit", async () => {
    await captureAsyncOutput(() =>
      handleHistoryCommand({ limit: "2" }, fakeCommand({ json: true })),
    );

    expect(renderHistoryMock).toHaveBeenCalledTimes(1);
    expect(renderHistoryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chain: "mainnet",
        chainId: 1,
        currentBlock: 250n,
        avgBlockTimeSec: expect.any(Number),
        events: [
          expect.objectContaining({
            type: "ragequit",
            paId: "PA-1",
          }),
          expect.objectContaining({
            type: "withdrawal",
            paId: "PA-1",
          }),
        ],
      }),
    );
    expect(syncAccountEventsMock).toHaveBeenCalledTimes(1);
  });

  test("merges stored legacy migration history and suppresses safe-side duplicates", async () => {
    initializeAccountServiceWithStateMock.mockImplementationOnce(async () => ({
      accountService: {
        account: {
          poolAccounts: new Map([
            [
              1n,
              [
                {
                  label: 7n,
                  deposit: {
                    label: 7n,
                    hash: 700n,
                    value: 900000000000000000n,
                    blockNumber: 150n,
                    txHash: "0x" + "44".repeat(32),
                  },
                  children: [
                    {
                      label: 7n,
                      hash: 700n,
                      value: 900000000000000000n,
                      blockNumber: 150n,
                      txHash: "0x" + "44".repeat(32),
                    },
                  ],
                  ragequit: null,
                },
              ],
            ],
          ]),
          __legacyPoolAccounts: new Map([
            [
              1n,
              [
                {
                  label: 7n,
                  deposit: {
                    label: 7n,
                    hash: 600n,
                    value: 900000000000000000n,
                    blockNumber: 100n,
                    txHash: "0x" + "55".repeat(32),
                  },
                  children: [
                    {
                      label: 7n,
                      hash: 601n,
                      value: 900000000000000000n,
                      blockNumber: 150n,
                      txHash: "0x" + "44".repeat(32),
                      isMigration: true,
                    },
                  ],
                  ragequit: null,
                  isMigrated: true,
                },
              ],
            ],
          ]),
        },
      },
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
    }));

    await captureAsyncOutput(() =>
      handleHistoryCommand({ limit: "3" }, fakeCommand({ json: true })),
    );

    expect(renderHistoryMock).toHaveBeenCalledTimes(1);
    expect(renderHistoryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        events: [
          expect.objectContaining({
            type: "migration",
            paId: "PA-1",
          }),
          expect.objectContaining({
            type: "deposit",
            paId: "PA-1",
          }),
        ],
      }),
    );
  });

  test("renders the no-pools state without loading wallet history", async () => {
    listPoolsMock.mockImplementationOnce(async () => []);

    await captureAsyncOutput(() =>
      handleHistoryCommand({}, fakeCommand({ json: true })),
    );

    expect(renderHistoryNoPoolsMock).toHaveBeenCalledWith(
      expect.anything(),
      "mainnet",
    );
    expect(initializeAccountServiceWithStateMock).not.toHaveBeenCalled();
  });

  test("passes --no-sync through to account event syncing", async () => {
    await captureAsyncOutput(() =>
      handleHistoryCommand({ sync: false, limit: "2" }, fakeCommand({ json: true })),
    );

    expect(syncAccountEventsMock).toHaveBeenCalledTimes(1);
    expect(syncAccountEventsMock.mock.calls[0]?.[4]).toMatchObject({
      skip: true,
      errorLabel: "History",
      allowLegacyRecoveryVisibility: true,
    });
  });

  test("renders history even when the current block lookup fails", async () => {
    getPublicClientMock.mockImplementationOnce(() => ({
      getBlockNumber: async () => {
        throw new Error("rpc unavailable");
      },
    }));

    await captureAsyncOutput(() =>
      handleHistoryCommand({ limit: "2" }, fakeCommand({ json: true })),
    );

    expect(renderHistoryMock).toHaveBeenCalledTimes(1);
    expect(renderHistoryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentBlock: null,
      }),
    );
  });

  test("rejects invalid limits before touching account state", async () => {
    await captureAsyncOutput(() =>
      handleHistoryCommand({ limit: "0" }, fakeCommand({ json: true })),
    );

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    expect(printErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Invalid --limit value: 0.",
        hint: "--limit must be a positive integer.",
      }),
      true,
    );
    expect(listPoolsMock).not.toHaveBeenCalled();
  });
});
