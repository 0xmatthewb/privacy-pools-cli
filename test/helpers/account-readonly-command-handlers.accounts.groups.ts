import { expect, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import { resolveGlobalMode } from "../../src/utils/mode.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "./output.ts";
import {
  DECLINED_LEGACY_POOL_ACCOUNT,
  fakeCommand,
  getReadonlyCommandHandlers,
  readonlyHarnessMocks,
  useIsolatedHome,
} from "./account-readonly-command-handlers.harness.ts";

export function registerReadonlyAccountsTests(): void {
  test("accounts rejects incompatible compact mode flags", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

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
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

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
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

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
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

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

  test("accounts --no-sync fails before pool discovery when the saved snapshot is stale", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.listPoolsMock.mockClear();
    readonlyHarnessMocks.listKnownPoolsFromRegistryMock.mockClear();
    readonlyHarnessMocks.assertAccountStateFreshForNoSyncMock.mockImplementationOnce(
      () => {
        throw new Error("stale snapshot");
      },
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { sync: false },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain("stale snapshot");
    expect(readonlyHarnessMocks.listPoolsMock).not.toHaveBeenCalled();
    expect(readonlyHarnessMocks.listKnownPoolsFromRegistryMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(1);
  });

  test("accounts --no-sync uses registry-backed pool discovery", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.listPoolsMock.mockClear();
    readonlyHarnessMocks.listKnownPoolsFromRegistryMock.mockClear();

    const { json } = await captureAsyncJsonOutput(() =>
      handleAccountsCommand(
        { sync: false, summary: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(readonlyHarnessMocks.listKnownPoolsFromRegistryMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet" }),
      undefined,
    );
    expect(readonlyHarnessMocks.listPoolsMock).not.toHaveBeenCalled();
  });

  test("accounts summary and pending-only modes route through the compact JSON variants", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

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

  test("status pending summary loader returns pending Pool Account summaries", async () => {
    useIsolatedHome("mainnet");
    const { loadPendingPoolAccountSummariesForStatus } = getReadonlyCommandHandlers();

    const summaries = await loadPendingPoolAccountSummariesForStatus({
      chainConfig: CHAINS.mainnet,
      mode: resolveGlobalMode({ json: true }),
    });

    expect(summaries).toEqual([
      expect.objectContaining({
        poolAccountNumber: 2,
        poolAccountId: "PA-2",
        status: "pending",
        aspStatus: "pending",
        asset: "ETH",
        value: "400000000000000000",
        label: "102",
        chain: "mainnet",
        chainId: CHAINS.mainnet.id,
      }),
    ]);
  });

  test("accounts validates and applies compact account limits", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

    const limited = await captureAsyncJsonOutput(() =>
      handleAccountsCommand(
        { limit: "1" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );
    expect(limited.json.success).toBe(true);
    expect(limited.json.accounts).toHaveLength(1);
    expect(limited.json.accounts[0].poolAccountId).toBe("PA-1");

    const invalid = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { limit: "0" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );
    expect(invalid.json.success).toBe(false);
    expect(invalid.json.errorCode).toBe("INPUT_INVALID_VALUE");
    expect(invalid.exitCode).toBe(2);
  });

  test("accounts rejects refresh with cached no-sync reads", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { sync: false, refresh: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_FLAG_CONFLICT");
    expect(exitCode).toBe(2);
  });

  test("accounts renders an empty JSON payload when pool discovery returns no pools", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.listPoolsMock.mockImplementationOnce(async () => []);

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
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.buildAllPoolAccountRefsMock.mockImplementationOnce(
      () => [],
    );
    readonlyHarnessMocks.collectActiveLabelsMock.mockImplementationOnce(
      () => [],
    );
    readonlyHarnessMocks.loadAspDepositReviewStateMock.mockImplementationOnce(
      async () => ({
        approvedLabels: new Set<string>(),
        reviewStatuses: new Map<string, string>(),
        rawReviewStatuses: new Map<string, string>(),
        hasIncompleteReviewData: false,
      }),
    );
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: {
            poolAccounts: new Map(),
            __legacyPoolAccounts: new Map([
              [1n, [DECLINED_LEGACY_POOL_ACCOUNT]],
            ]),
          },
          getSpendableCommitments: () => new Map(),
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
        legacyDeclinedLabels: new Set(["303"]),
      }),
    );

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

  test("accounts keeps declined legacy Pool Accounts visible in mixed migration-required wallets", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: {
            poolAccounts: new Map(),
            __legacyPoolAccounts: new Map([
              [1n, [DECLINED_LEGACY_POOL_ACCOUNT]],
            ]),
          },
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
        legacyDeclinedLabels: new Set(["303"]),
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleAccountsCommand({}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "approved",
          poolAccountId: "PA-1",
        }),
        expect.objectContaining({
          status: "pending",
          poolAccountId: "PA-2",
        }),
        expect.objectContaining({
          status: "declined",
          aspStatus: "declined",
          poolAccountId: "PA-3",
          label: "303",
          value: "700000000000000000",
        }),
      ]),
    );
  });

  test("accounts surfaces partial ASP review warnings for successful single-chain loads", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.loadAspDepositReviewStateMock.mockImplementationOnce(
      async () => ({
        approvedLabels: new Set<string>(["101"]),
        reviewStatuses: new Map<string, string>([["101", "approved"]]),
        rawReviewStatuses: new Map<string, string>([["101", "approved"]]),
        hasIncompleteReviewData: true,
      }),
    );

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
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementation(
      async () => {
        throw new Error("rpc unavailable");
      },
    );

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
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => {
        throw new Error("mainnet rpc unavailable");
      },
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand({}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain(
      "mainnet rpc unavailable",
    );
    expect(exitCode).toBe(1);
  });

  test("accounts keeps partial multi-chain warnings while returning successful results", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementation(
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
