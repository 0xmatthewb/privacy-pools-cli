import { afterEach, describe, expect, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import {
  saveAccount,
  saveSyncMeta,
  syncAccountEvents,
  loadAccount,
  loadSyncMeta,
} from "../../src/services/account.ts";
import { cleanupTrackedTempDirs, createTrackedTempDir } from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;
const MNEMONIC =
  "test test test test test test test test test test test junk";
const CHAIN_ID = 1;

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-account-sync-events-");
  process.env.PRIVACY_POOLS_HOME = home;
  return home;
}

function sampleAccountState(overrides: Record<string, unknown> = {}) {
  return {
    masterKeys: [1n, 2n],
    poolAccounts: new Map([
      [1n, [{ label: 11n, deposit: { hash: 101n }, children: [] }]],
      [2n, [{ label: 22n, deposit: { hash: 202n }, children: [] }]],
    ]),
    creationTimestamp: 0n,
    lastUpdateTimestamp: 0n,
    __legacyPoolAccounts: new Map(),
    __legacyMigrationReadinessStatus: "no_legacy",
    ...overrides,
  };
}

function samplePoolInfos() {
  return [
    {
      chainId: CHAIN_ID,
      address: "0x1111111111111111111111111111111111111111",
      scope: 1n,
      deploymentBlock: 1n,
    },
  ];
}

describe("account syncAccountEvents coverage", () => {
  afterEach(() => {
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }
    cleanupTrackedTempDirs();
  });

  test("skips sync when freshness metadata is still valid", async () => {
    useIsolatedHome();
    saveSyncMeta(CHAIN_ID);

    const accountService = {
      account: sampleAccountState(),
    };

    const performed = await syncAccountEvents(
      accountService as never,
      samplePoolInfos(),
      [{ pool: samplePoolInfos()[0]!.address, symbol: "ETH" }],
      CHAIN_ID,
      {
        skip: false,
        force: false,
        silent: true,
        isJson: true,
        isVerbose: true,
        errorLabel: "Accounts",
        dataService: {} as never,
        mnemonic: MNEMONIC,
      },
    );

    expect(performed).toBe(false);
  });

  test("warns per pool and fails closed when rebuilt scopes return partial sync errors", async () => {
    useIsolatedHome();
    saveAccount(CHAIN_ID, sampleAccountState());

    AccountService.initializeWithEvents = (async () => ({
      account: { account: sampleAccountState() } as never,
      legacyAccount: undefined,
      errors: [{ scope: 1n, reason: "rpc timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await expect(
        syncAccountEvents(
          { account: sampleAccountState() } as never,
          samplePoolInfos(),
          [{ pool: samplePoolInfos()[0]!.address, symbol: "ETH" }],
          CHAIN_ID,
          {
            skip: false,
            force: true,
            silent: false,
            isJson: false,
            isVerbose: false,
            errorLabel: "Accounts",
            dataService: {} as never,
            mnemonic: MNEMONIC,
          },
        ),
      ).rejects.toMatchObject({
        category: "RPC",
        retryable: true,
        message: "Accounts sync failed for 1 pool(s).",
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(stderrWrites.join("")).toContain("Sync failed for ETH pool: rpc timeout");
  });

  test("falls back to scope ids in sync warnings when no pool symbol metadata is available", async () => {
    useIsolatedHome();
    saveAccount(CHAIN_ID, sampleAccountState());

    AccountService.initializeWithEvents = (async () => ({
      account: { account: sampleAccountState() } as never,
      legacyAccount: undefined,
      errors: [{ scope: 1n, reason: "rpc timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      await expect(
        syncAccountEvents(
          { account: sampleAccountState() } as never,
          samplePoolInfos(),
          [],
          CHAIN_ID,
          {
            skip: false,
            force: true,
            silent: false,
            isJson: false,
            isVerbose: false,
            errorLabel: "Accounts",
            dataService: {} as never,
            mnemonic: MNEMONIC,
          },
        ),
      ).rejects.toThrow("Accounts sync failed for 1 pool(s).");
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(stderrWrites.join("")).toContain("Sync failed for 1 pool: rpc timeout");
  });

  test("preserves richer saved scopes during a successful forced sync and persists new freshness metadata", async () => {
    useIsolatedHome();
    saveAccount(
      CHAIN_ID,
      sampleAccountState({
        poolAccounts: new Map([
          [
            1n,
            [
              { label: 11n, deposit: { hash: 101n }, children: [] },
              { label: 12n, deposit: { hash: 102n }, children: [] },
            ],
          ],
          [2n, [{ label: 22n, deposit: { hash: 202n }, children: [] }]],
        ]),
      }),
    );

    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: sampleAccountState({
          poolAccounts: new Map([[1n, [{ label: 111n, deposit: { hash: 303n }, children: [] }]]]),
        }),
      } as never,
      legacyAccount: undefined,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const accountService = {
        account: sampleAccountState({
          poolAccounts: new Map([
            [
              1n,
              [
                { label: 11n, deposit: { hash: 101n }, children: [] },
                { label: 12n, deposit: { hash: 102n }, children: [] },
              ],
            ],
            [2n, [{ label: 22n, deposit: { hash: 202n }, children: [] }]],
          ]),
        }),
      };
      const performed = await syncAccountEvents(
        accountService as never,
        samplePoolInfos(),
        [{ pool: samplePoolInfos()[0]!.address, symbol: "ETH" }],
        CHAIN_ID,
        {
          skip: false,
          force: true,
          silent: false,
          isJson: false,
          isVerbose: false,
          errorLabel: "Accounts",
          dataService: {} as never,
          mnemonic: MNEMONIC,
        },
      );

      expect(performed).toBe(true);
      expect(accountService.account.poolAccounts.get(1n)).toEqual([
        { label: 11n, deposit: { hash: 101n }, children: [] },
        { label: 12n, deposit: { hash: 102n }, children: [] },
      ]);
      expect(accountService.account.poolAccounts.get(2n)).toEqual([
        { label: 22n, deposit: { hash: 202n }, children: [] },
      ]);
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(stderrWrites.join("")).toContain(
      "keeping the saved account entries for scope 1",
    );
    expect(loadAccount(CHAIN_ID)?.poolAccounts.get(1n)).toEqual([
      { label: 11n, deposit: { hash: 101n }, children: [] },
      { label: 12n, deposit: { hash: 102n }, children: [] },
    ]);
    expect(loadAccount(CHAIN_ID)?.poolAccounts.get(2n)).toEqual([
      { label: 22n, deposit: { hash: 202n }, children: [] },
    ]);
    expect(loadSyncMeta(CHAIN_ID)).toEqual({
      lastSyncTime: expect.any(Number),
    });
  });

  test("persists rebuilt legacy visibility metadata alongside a successful sync", async () => {
    useIsolatedHome();
    const legacyPoolAccounts = new Map([
      [99n, [{ label: 909n, deposit: { hash: 909n }, children: [] }]],
    ]);
    AccountService.initializeWithEvents = (async () => ({
      account: { account: sampleAccountState() } as never,
      legacyAccount: {
        account: sampleAccountState({
          poolAccounts: legacyPoolAccounts,
        }),
      } as never,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const accountService = {
      account: sampleAccountState(),
    };
    const performed = await syncAccountEvents(
      accountService as never,
      samplePoolInfos(),
      [{ pool: samplePoolInfos()[0]!.address, symbol: "ETH" }],
      CHAIN_ID,
      {
        skip: false,
        force: true,
        silent: true,
        isJson: true,
        isVerbose: false,
        errorLabel: "Accounts",
        dataService: {} as never,
        mnemonic: MNEMONIC,
      },
    );

    expect(performed).toBe(true);
    expect(accountService.account.__legacyPoolAccounts).toEqual(legacyPoolAccounts);
    expect(accountService.account.__legacyMigrationReadinessStatus).toBe("no_legacy");
  });

  test("persists a successful sync even when no legacy account visibility metadata is returned", async () => {
    useIsolatedHome();
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: sampleAccountState({
          poolAccounts: new Map([[1n, [{ label: 111n, deposit: { hash: 303n }, children: [] }]]]),
        }),
      } as never,
      legacyAccount: undefined,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const accountService = {
      account: sampleAccountState(),
    };
    const performed = await syncAccountEvents(
      accountService as never,
      samplePoolInfos(),
      [{ pool: samplePoolInfos()[0]!.address, symbol: "ETH" }],
      CHAIN_ID,
      {
        skip: false,
        force: true,
        silent: true,
        isJson: true,
        isVerbose: false,
        errorLabel: "Accounts",
        dataService: {} as never,
        mnemonic: MNEMONIC,
      },
    );

    expect(performed).toBe(true);
    expect(accountService.account.__legacyPoolAccounts).toEqual(new Map());
    expect(accountService.account.__legacyMigrationReadinessStatus).toBe("no_legacy");
    expect(loadAccount(CHAIN_ID)?.poolAccounts.get(1n)).toEqual([
      { label: 111n, deposit: { hash: 303n }, children: [] },
    ]);
  });
});
