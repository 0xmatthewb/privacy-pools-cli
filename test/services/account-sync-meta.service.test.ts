import { afterEach, describe, expect, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSyncFresh,
  loadSyncMeta,
  saveSyncMeta,
  syncAccountEvents,
} from "../../src/services/account.ts";
import { CLIError } from "../../src/utils/errors.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;
const MNEMONIC = "test test test test test test test test test test test junk";

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-account-sync-meta-");
  process.env.PRIVACY_POOLS_HOME = home;
  mkdirSync(join(home, "accounts"), { recursive: true });
  return home;
}

afterEach(() => {
  AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  cleanupTrackedTempDirs();
});

describe("account sync metadata + event syncing", () => {
  test("loadSyncMeta returns null for corrupt sync metadata files", () => {
    const home = useIsolatedHome();
    writeFileSync(join(home, "accounts", "1.sync.json"), "{not-json", "utf8");

    expect(loadSyncMeta(1)).toBeNull();
  });

  test("saveSyncMeta stamps a fresh sync record", () => {
    useIsolatedHome();

    saveSyncMeta(1);

    expect(loadSyncMeta(1)).toEqual(
      expect.objectContaining({
        lastSyncTime: expect.any(Number),
      }),
    );
    expect(isSyncFresh(1)).toBe(true);
  });

  test("isSyncFresh returns false for stale sync timestamps", () => {
    const home = useIsolatedHome();
    writeFileSync(
      join(home, "accounts", "1.sync.json"),
      JSON.stringify({ lastSyncTime: Date.now() - 360_000 }),
      "utf8",
    );

    expect(isSyncFresh(1)).toBe(false);
  });

  test("syncAccountEvents skips syncing when --no-sync is requested", async () => {
    useIsolatedHome();
    const accountService = {
      account: { poolAccounts: new Map() },
    };

    const synced = await syncAccountEvents(
      accountService as never,
      [
        {
          chainId: 1,
          address: "0x1111111111111111111111111111111111111111",
          scope: 1n,
          deploymentBlock: 1n,
        },
      ],
      [{ pool: "0x1111111111111111111111111111111111111111", symbol: "ETH" }],
      1,
      {
        skip: true,
        force: false,
        silent: true,
        isJson: true,
        isVerbose: false,
        errorLabel: "Account",
        dataService: {} as never,
        mnemonic: MNEMONIC,
      },
    );

    expect(synced).toBe(false);
    expect(loadSyncMeta(1)).toBeNull();
  });

  test("syncAccountEvents skips when the last sync is still fresh", async () => {
    useIsolatedHome();
    saveSyncMeta(1);

    let called = false;
    AccountService.initializeWithEvents = (async () => {
      called = true;
      throw new Error("should not run");
    }) as typeof AccountService.initializeWithEvents;

    const accountService = {
      account: { poolAccounts: new Map() },
    };

    const synced = await syncAccountEvents(
      accountService as never,
      [
        {
          chainId: 1,
          address: "0x1111111111111111111111111111111111111111",
          scope: 1n,
          deploymentBlock: 1n,
        },
      ],
      [{ pool: "0x1111111111111111111111111111111111111111", symbol: "ETH" }],
      1,
      {
        skip: false,
        force: false,
        silent: true,
        isJson: true,
        isVerbose: false,
        errorLabel: "Account",
        dataService: {} as never,
        mnemonic: MNEMONIC,
      },
    );

    expect(synced).toBe(false);
    expect(called).toBe(false);
  });

  test("syncAccountEvents rebuilds target scopes and preserves untouched ones", async () => {
    useIsolatedHome();
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: {
          masterKeys: [1n, 2n],
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
          poolAccounts: new Map([[1n, [{ label: 11n }]]]),
        },
      } as never,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const accountService = {
      account: {
        masterKeys: [1n, 2n],
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
        poolAccounts: new Map([[2n, [{ label: 22n }]]]),
      },
    };

    const synced = await syncAccountEvents(
      accountService as never,
      [
        {
          chainId: 1,
          address: "0x1111111111111111111111111111111111111111",
          scope: 1n,
          deploymentBlock: 1n,
        },
      ],
      [{ pool: "0x1111111111111111111111111111111111111111", symbol: "ETH" }],
      1,
      {
        skip: false,
        force: true,
        silent: true,
        isJson: true,
        isVerbose: false,
        errorLabel: "Account",
        dataService: {} as never,
        mnemonic: MNEMONIC,
      },
    );

    expect(synced).toBe(true);
    expect(accountService.account.poolAccounts.get(1n)).toEqual([{ label: 11n }]);
    expect(accountService.account.poolAccounts.get(2n)).toEqual([{ label: 22n }]);
    expect(loadSyncMeta(1)).not.toBeNull();
  });

  test("syncAccountEvents fails closed on partial pool sync failures", async () => {
    useIsolatedHome();
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: {
          masterKeys: [1n, 2n],
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
          poolAccounts: new Map(),
        },
      } as never,
      errors: [{ scope: 2n, reason: "rpc down" }],
    })) as typeof AccountService.initializeWithEvents;

    const accountService = {
      account: {
        masterKeys: [1n, 2n],
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
        poolAccounts: new Map(),
      },
    };

    await expect(
      syncAccountEvents(
        accountService as never,
        [
          {
            chainId: 1,
            address: "0x1111111111111111111111111111111111111111",
            scope: 1n,
            deploymentBlock: 1n,
          },
          {
            chainId: 1,
            address: "0x2222222222222222222222222222222222222222",
            scope: 2n,
            deploymentBlock: 1n,
          },
        ],
        [
          { pool: "0x1111111111111111111111111111111111111111", symbol: "ETH" },
          { pool: "0x2222222222222222222222222222222222222222", symbol: "USDC" },
        ],
        1,
        {
          skip: false,
          force: true,
          silent: true,
          isJson: true,
          isVerbose: false,
          errorLabel: "Account",
          dataService: {} as never,
          mnemonic: MNEMONIC,
        },
      ),
    ).rejects.toMatchObject({
      category: "RPC",
      code: "RPC_ERROR",
      retryable: true,
    } satisfies Partial<CLIError>);

    expect(loadSyncMeta(1)).toBeNull();
  });
});
