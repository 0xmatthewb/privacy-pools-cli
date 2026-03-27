import { afterEach, describe, expect, test } from "bun:test";
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

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-account-sync-meta-");
  process.env.PRIVACY_POOLS_HOME = home;
  mkdirSync(join(home, "accounts"), { recursive: true });
  return home;
}

afterEach(() => {
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
      getDepositEvents: async () => {
        throw new Error("should not run");
      },
      getWithdrawalEvents: async () => {
        throw new Error("should not run");
      },
      getRagequitEvents: async () => {
        throw new Error("should not run");
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
        skip: true,
        force: false,
        silent: true,
        isJson: true,
        isVerbose: false,
        errorLabel: "Account",
      },
    );

    expect(synced).toBe(false);
    expect(loadSyncMeta(1)).toBeNull();
  });

  test("syncAccountEvents skips when the last sync is still fresh", async () => {
    useIsolatedHome();
    saveSyncMeta(1);

    let called = false;
    const accountService = {
      account: { poolAccounts: new Map() },
      getDepositEvents: async () => {
        called = true;
      },
      getWithdrawalEvents: async () => {
        called = true;
      },
      getRagequitEvents: async () => {
        called = true;
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
        force: false,
        silent: true,
        isJson: true,
        isVerbose: false,
        errorLabel: "Account",
      },
    );

    expect(synced).toBe(false);
    expect(called).toBe(false);
  });

  test("syncAccountEvents persists account state and sync metadata on success", async () => {
    useIsolatedHome();
    const calls: string[] = [];
    const accountService = {
      account: {
        poolAccounts: new Map([[1n, [{ label: 11n }]]]),
      },
      getDepositEvents: async () => {
        calls.push("deposit");
      },
      getWithdrawalEvents: async () => {
        calls.push("withdrawal");
      },
      getRagequitEvents: async () => {
        calls.push("ragequit");
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
      },
    );

    expect(synced).toBe(true);
    expect(calls).toEqual(["deposit", "withdrawal", "ragequit"]);
    expect(loadSyncMeta(1)).not.toBeNull();
  });

  test("syncAccountEvents fails closed on partial pool sync failures", async () => {
    useIsolatedHome();
    const accountService = {
      account: { poolAccounts: new Map() },
      getDepositEvents: async (poolInfo: { address: string }) => {
        if (poolInfo.address.endsWith("2")) {
          throw new Error("rpc down");
        }
      },
      getWithdrawalEvents: async () => undefined,
      getRagequitEvents: async () => undefined,
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
