import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";
import {
  ACCOUNT_FILE_VERSION,
  needsLegacyAccountRebuild,
  isSyncFresh,
  loadSyncMeta,
  loadAccount,
  saveAccount,
  serialize,
  deserialize,
  initializeAccountService,
  initializeAccountServiceWithState,
  getStoredLegacyReadinessStatus,
  syncAccountEvents,
} from "../../src/services/account.ts";
import { CLIError } from "../../src/utils/errors.ts";

const MNEMONIC = "test test test test test test test test test test test junk";
const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;
const ORIGINAL_FETCH = global.fetch;

function isolatedHome(): string {
  const home = createTrackedTempDir("pp-account-persist-test-");
  // Ensure accounts subdirectory exists
  mkdirSync(join(home, "accounts"), { recursive: true });
  return home;
}

function samplePool() {
  return [{
    chainId: 11155111,
    address: "0x0000000000000000000000000000000000000001" as const,
    scope: 1n,
    deploymentBlock: 1n,
  }];
}

function makeLegacyAccount(overrides: Partial<{
  value: bigint;
  isMigrated: boolean;
  ragequit: boolean;
}> = {}) {
  const value = overrides.value ?? 1n;
  const isMigrated = overrides.isMigrated ?? false;
  const ragequit = overrides.ragequit ?? false;

  return new AccountService({} as any, {
    account: {
      masterKeys: [1n, 2n],
      poolAccounts: new Map([
        [1n, [{
          label: 11n,
          deposit: {
            hash: 12n,
            value,
            label: 11n,
            nullifier: 13n,
            secret: 14n,
            blockNumber: 1n,
            txHash: "0x" + "11".repeat(32),
          },
          children: [],
          isMigrated,
          ragequit: ragequit
            ? {
                label: 11n,
                value,
                transactionHash: "0x" + "22".repeat(32),
                blockNumber: 2n,
                timestamp: 3n,
              }
            : undefined,
        }]],
      ]),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
    } as any,
  });
}

describe("account persistence", () => {
  afterEach(() => {
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }
    cleanupTrackedTempDirs();
  });

  /* ---------------------------------------------------------------- */
  /*  loadAccount — corrupt file handling                              */
  /* ---------------------------------------------------------------- */

  test("loadAccount returns null when no account file exists", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const result = loadAccount(99999);
    expect(result).toBeNull();
  });

  test("loadAccount throws INPUT CLIError on corrupt JSON file", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const accountsDir = join(home, "accounts");
    writeFileSync(join(accountsDir, "11155111.json"), "{{not valid json", "utf-8");

    try {
      loadAccount(11155111);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const e = err as CLIError;
      expect(e.category).toBe("INPUT");
      expect(e.message).toContain("corrupt or unreadable");
      expect(e.hint).toContain("privacy-pools sync");
    }
  });

  /* ---------------------------------------------------------------- */
  /*  saveAccount + loadAccount round-trip                             */
  /* ---------------------------------------------------------------- */

  test("saveAccount and loadAccount round-trip preserves BigInt and Map values", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const account = {
      chainId: 11155111,
      balance: 1000000000000000000n,
      poolAccounts: new Map([["scope1", { amount: 500n }]]),
    };

    saveAccount(11155111, account);
    const loaded = loadAccount(11155111);

    expect(loaded).not.toBeNull();
    expect(loaded.chainId).toBe(11155111);
    expect(loaded.balance).toBe(1000000000000000000n);
    expect(loaded.poolAccounts).toBeInstanceOf(Map);
    expect(loaded.poolAccounts.get("scope1")).toEqual({ amount: 500n });
  });

  test("saveAccount ignores legacy predictable temp-file symlinks", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const accountsDir = join(home, "accounts");
    const victimPath = join(home, "victim.txt");
    writeFileSync(victimPath, "do not overwrite", "utf-8");
    symlinkSync(victimPath, join(accountsDir, "11155111.json.tmp"));

    saveAccount(11155111, { poolAccounts: new Map() });

    expect(readFileSync(victimPath, "utf-8")).toBe("do not overwrite");
    expect(loadAccount(11155111)).toMatchObject({
      __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
    });
  });

  test("loadAccount ignores interrupted temp siblings and returns the last committed state", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const accountsDir = join(home, "accounts");

    saveAccount(11155111, {
      chainId: 11155111,
      poolAccounts: new Map([["scope1", { amount: 1n }]]),
    });

    writeFileSync(
      join(accountsDir, "11155111.json.interrupted.tmp"),
      "{not valid json",
      "utf-8",
    );

    const loaded = loadAccount(11155111);
    expect(loaded).toMatchObject({
      chainId: 11155111,
      __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
    });
    expect(loaded.poolAccounts).toBeInstanceOf(Map);
    expect(loaded.poolAccounts.get("scope1")).toEqual({ amount: 1n });
  });

  /* ---------------------------------------------------------------- */
  /*  serialize / deserialize                                          */
  /* ---------------------------------------------------------------- */

  test("serialize handles BigInt values", () => {
    const json = serialize({ value: 123n });
    expect(json).toContain('"__type": "bigint"');
    expect(json).toContain('"value": "123"');
  });

  test("deserialize reconstructs BigInt values", () => {
    const raw = JSON.stringify({ value: { __type: "bigint", value: "999" } });
    const result = deserialize(raw) as { value: bigint };
    expect(result.value).toBe(999n);
  });

  test("serialize handles Map values", () => {
    const json = serialize({ m: new Map([["a", 1]]) });
    expect(json).toContain('"__type": "map"');
  });

  test("deserialize reconstructs Map values", () => {
    const raw = JSON.stringify({ m: { __type: "map", value: [["a", 1]] } });
    const result = deserialize(raw) as { m: Map<string, number> };
    expect(result.m).toBeInstanceOf(Map);
    expect(result.m.get("a")).toBe(1);
  });

  test("needsLegacyAccountRebuild detects versionless saved accounts", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({ poolAccounts: new Map() }),
      "utf-8",
    );

    expect(needsLegacyAccountRebuild(11155111)).toBe(true);

    saveAccount(11155111, {
      poolAccounts: new Map(),
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    });
    expect(needsLegacyAccountRebuild(11155111)).toBe(false);
  });

  test("needsLegacyAccountRebuild detects current-version snapshots missing legacy history", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({
        __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
        poolAccounts: new Map(),
      }),
      "utf-8",
    );

    expect(needsLegacyAccountRebuild(11155111)).toBe(true);
  });

  test("needsLegacyAccountRebuild detects current-version snapshots missing legacy readiness", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({
        __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
        poolAccounts: new Map(),
        __legacyPoolAccounts: new Map(),
      }),
      "utf-8",
    );

    expect(needsLegacyAccountRebuild(11155111)).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /*  initializeAccountService — saved-account paths                   */
  /* ---------------------------------------------------------------- */

  test("saved account + forceSync + strictSync=true fails closed on event sync failure", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    // Write a saved account file so the saved-account path is triggered
    const fakeAccount = {
      poolAccounts: new Map(),
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    };
    saveAccount(11155111, fakeAccount);

    // DataService mock — methods on the service instance will throw
    const mockDataService = {} as any;

    // AccountService constructor will be called with { account: savedAccount }
    // The sync calls (getDepositEvents, etc.) will throw
    // We need to mock the AccountService instance methods.
    // Since we can't easily mock instance methods, we provide a pool and let the
    // actual SDK service call throw when it tries to sync.

    try {
      await initializeAccountService(
        mockDataService,
        MNEMONIC,
        samplePool(),
        11155111,
        true,   // forceSync
        true,   // suppressWarnings
        true    // strictSync
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const e = err as CLIError;
      expect(e.category).toBe("RPC");
      expect(e.message).toContain("Failed to sync account state");
      expect(e.hint).toContain("RPC connectivity");
    }
  });

  test("saved account + forceSync + strictSync=false warns but returns service", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        },
      } as any,
      errors: [{ scope: 1n, reason: "mock rpc timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    // Write a saved account file
    const fakeAccount = {
      masterKeys: [1n, 2n],
      poolAccounts: new Map(),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    };
    saveAccount(11155111, fakeAccount);

    const mockDataService = {} as any;

    // Capture stderr to verify warning
    const stderrWrites: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      const service = await initializeAccountService(
        mockDataService,
        MNEMONIC,
        samplePool(),
        11155111,
        true,   // forceSync
        false,  // suppressWarnings — let warnings through
        false   // strictSync
      );

      // Should return a service despite sync failures
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(AccountService);
      // Should have emitted a warning
      expect(
        stderrWrites.some((w) =>
          w.includes("Warning: account sync had partial failures"),
        ),
      ).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("legacy saved account snapshots are rebuilt through initializeWithEvents", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({ poolAccounts: new Map() }),
      "utf-8"
    );

    const rebuiltAccount = {
      masterKeys: [1n, 2n],
      poolAccounts: new Map(),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
    } as any;
    const rebuiltService = new AccountService({} as any, {
      account: rebuiltAccount,
    });

    let initializeCalls = 0;
    AccountService.initializeWithEvents = (async (
      dataService: any,
      source: { mnemonic: string },
    ) => {
      initializeCalls++;
      expect(dataService).toEqual({});
      expect(source).toEqual({ mnemonic: MNEMONIC });
      return {
        account: rebuiltService,
        errors: [],
      } as any;
    }) as typeof AccountService.initializeWithEvents;

    const result = await initializeAccountServiceWithState(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      {
        allowLegacyAccountRebuild: true,
        suppressWarnings: true,
        strictSync: true,
      }
    );

    expect(result.accountService).toBe(rebuiltService);
    expect(result.rebuiltLegacyAccount).toBe(true);
    expect(result.skipImmediateSync).toBe(true);
    expect(initializeCalls).toBe(1);
    expect(loadAccount(11155111)?.__privacyPoolsCliAccountVersion).toBe(
      ACCOUNT_FILE_VERSION
    );
    expect(isSyncFresh(11155111)).toBe(true);
  });

  test("fresh mnemonic restore fails closed when SDK reports unmigrated legacy commitments", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    global.fetch = (async () =>
      new Response(
        JSON.stringify([{ label: "11", reviewStatus: "approved" }]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof global.fetch;

    AccountService.initializeWithEvents = (async () => ({
      account: new AccountService({} as any, {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        } as any,
      }),
      legacyAccount: makeLegacyAccount(),
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          suppressWarnings: true,
        },
      )
    ).rejects.toMatchObject({
      category: "INPUT",
      code: "ACCOUNT_MIGRATION_REQUIRED",
    });

    expect(loadAccount(11155111)).toBeNull();
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("fresh mnemonic restore fails with a retryable review-incomplete error when legacy ASP review data is unavailable", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    global.fetch = (async () => {
      throw new Error("asp unavailable");
    }) as typeof global.fetch;

    AccountService.initializeWithEvents = (async () => ({
      account: new AccountService({} as any, {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        } as any,
      }),
      legacyAccount: makeLegacyAccount(),
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          suppressWarnings: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "ASP",
      code: "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
      retryable: true,
    });

    expect(loadAccount(11155111)).toBeNull();
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("stale saved snapshots are rebuilt before the migration gate runs", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    global.fetch = (async () =>
      new Response(
        JSON.stringify([{ label: "11", reviewStatus: "approved" }]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof global.fetch;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({
        __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION - 1,
        poolAccounts: new Map(),
      }),
      "utf-8",
    );

    let initializeCalls = 0;
    AccountService.initializeWithEvents = (async () => {
      initializeCalls += 1;
      return {
        account: new AccountService({} as any, {
          account: {
            masterKeys: [1n, 2n],
            poolAccounts: new Map(),
            creationTimestamp: 0n,
            lastUpdateTimestamp: 0n,
          } as any,
        }),
        legacyAccount: makeLegacyAccount(),
        errors: [],
      };
    }) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          allowLegacyAccountRebuild: true,
          suppressWarnings: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "INPUT",
      code: "ACCOUNT_MIGRATION_REQUIRED",
    });

    expect(initializeCalls).toBe(1);
  });

  test("current-version snapshots missing legacy history are rebuilt before the migration gate runs", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    global.fetch = (async () =>
      new Response(
        JSON.stringify([{ label: "11", reviewStatus: "approved" }]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof global.fetch;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({
        __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
        poolAccounts: new Map(),
      }),
      "utf-8",
    );

    let initializeCalls = 0;
    AccountService.initializeWithEvents = (async () => {
      initializeCalls += 1;
      return {
        account: new AccountService({} as any, {
          account: {
            masterKeys: [1n, 2n],
            poolAccounts: new Map(),
            creationTimestamp: 0n,
            lastUpdateTimestamp: 0n,
          } as any,
        }),
        legacyAccount: makeLegacyAccount(),
        errors: [],
      };
    }) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          allowLegacyAccountRebuild: true,
          suppressWarnings: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "INPUT",
      code: "ACCOUNT_MIGRATION_REQUIRED",
    });

    expect(initializeCalls).toBe(1);
  });

  test("stale saved snapshots are rejected when rebuild is disabled", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({
        __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION - 1,
        poolAccounts: new Map(),
      }),
      "utf-8",
    );

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          allowLegacyAccountRebuild: false,
          suppressWarnings: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "INPUT",
      message: expect.stringContaining("outdated"),
    });
  });

  test("current-version snapshots missing legacy history are rejected when rebuild is disabled", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({
        __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
        poolAccounts: new Map(),
      }),
      "utf-8",
    );

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          allowLegacyAccountRebuild: false,
          suppressWarnings: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "INPUT",
      message: expect.stringContaining("outdated"),
    });
  });

  test("legacy account rebuild fails closed when SDK reports unmigrated legacy commitments", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    global.fetch = (async () =>
      new Response(
        JSON.stringify([{ label: "11", reviewStatus: "approved" }]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof global.fetch;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({ poolAccounts: new Map() }),
      "utf-8",
    );

    AccountService.initializeWithEvents = (async () => ({
      account: new AccountService({} as any, {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        } as any,
      }),
      legacyAccount: makeLegacyAccount(),
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          allowLegacyAccountRebuild: true,
          suppressWarnings: true,
        },
      )
    ).rejects.toMatchObject({
      category: "INPUT",
      code: "ACCOUNT_MIGRATION_REQUIRED",
    });

    expect(loadAccount(11155111)?.__privacyPoolsCliAccountVersion).toBeUndefined();
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("fresh mnemonic restore surfaces website recovery guidance for declined-only legacy deposits", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    global.fetch = (async () =>
      new Response(
        JSON.stringify([
          { label: "11", reviewStatus: "declined" },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof global.fetch;

    AccountService.initializeWithEvents = (async () => ({
      account: new AccountService({} as any, {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        } as any,
      }),
      legacyAccount: makeLegacyAccount(),
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          suppressWarnings: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "INPUT",
      code: "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      message: expect.stringContaining("website-based recovery"),
      hint: expect.stringContaining("public recovery"),
    });

    expect(loadAccount(11155111)).toBeNull();
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("fresh mnemonic restore can persist website recovery visibility for read-only commands", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    global.fetch = (async () =>
      new Response(
        JSON.stringify([
          { label: "11", reviewStatus: "declined" },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof global.fetch;

    AccountService.initializeWithEvents = (async () => ({
      account: new AccountService({} as any, {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        } as any,
      }),
      legacyAccount: makeLegacyAccount(),
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const result = await initializeAccountServiceWithState(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      {
        allowLegacyRecoveryVisibility: true,
        suppressWarnings: true,
      },
    );

    expect(result.legacyDeclinedLabels).toEqual(new Set(["11"]));
    expect(getStoredLegacyReadinessStatus(loadAccount(11155111) as any)).toBe(
      "website_recovery_required",
    );
    expect(loadSyncMeta(11155111)).not.toBeNull();
  });

  test("saved-account sync surfaces website recovery guidance instead of dropping legacy state", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    saveAccount(11155111, {
      masterKeys: [1n, 2n],
      poolAccounts: new Map(),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    });

    global.fetch = (async () =>
      new Response(
        JSON.stringify([
          { label: "11", reviewStatus: "declined" },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof global.fetch;

    AccountService.initializeWithEvents = (async () => ({
      account: new AccountService({} as any, {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        } as any,
      }),
      legacyAccount: makeLegacyAccount(),
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          forceSyncSavedAccount: true,
          suppressWarnings: true,
          strictSync: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "INPUT",
      code: "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    });

    expect(loadAccount(11155111)?.__privacyPoolsCliAccountVersion).toBe(
      ACCOUNT_FILE_VERSION,
    );
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("saved blocked snapshots still fail closed for non-read-only commands", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    saveAccount(11155111, {
      masterKeys: [1n, 2n],
      poolAccounts: new Map(),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
      __legacyPoolAccounts: makeLegacyAccount().account.poolAccounts,
      __legacyMigrationReadinessStatus: "website_recovery_required",
    } as any);

    await expect(
      initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          suppressWarnings: true,
        },
      ),
    ).rejects.toMatchObject({
      category: "INPUT",
      code: "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    });
  });

  test("fresh mnemonic restore succeeds when legacy commitments are already migrated", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const rebuiltService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map(),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });

    AccountService.initializeWithEvents = (async () => ({
      account: rebuiltService,
      legacyAccount: makeLegacyAccount({ isMigrated: true }),
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const result = await initializeAccountServiceWithState(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      {
        suppressWarnings: true,
      }
    );

    expect(result.accountService).toBe(rebuiltService);
    expect(loadAccount(11155111)?.__privacyPoolsCliAccountVersion).toBe(
      ACCOUNT_FILE_VERSION
    );
    expect(isSyncFresh(11155111)).toBe(true);
  });

  test("partial fresh initialization does not persist a trusted snapshot", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const rebuiltService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map(),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });

    AccountService.initializeWithEvents = (async () => ({
      account: rebuiltService,
      errors: [{ scope: 1n, reason: "mock rpc timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    const result = await initializeAccountServiceWithState(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      {
        suppressWarnings: true,
        strictSync: false,
      },
    );

    expect(result.accountService).toBe(rebuiltService);
    expect(result.skipImmediateSync).toBe(false);
    expect(loadAccount(11155111)).toBeNull();
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("partial legacy rebuild does not overwrite the stale saved snapshot", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const accountsDir = join(home, "accounts");
    writeFileSync(
      join(accountsDir, "11155111.json"),
      serialize({
        __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION - 1,
        poolAccounts: new Map(),
      }),
      "utf-8",
    );

    const rebuiltService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map(),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });

    AccountService.initializeWithEvents = (async () => ({
      account: rebuiltService,
      errors: [{ scope: 1n, reason: "mock rpc timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    const result = await initializeAccountServiceWithState(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      {
        allowLegacyAccountRebuild: true,
        suppressWarnings: true,
        strictSync: false,
      },
    );

    expect(result.accountService).toBe(rebuiltService);
    expect(loadAccount(11155111)?.__privacyPoolsCliAccountVersion).toBe(
      ACCOUNT_FILE_VERSION - 1,
    );
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("partial sync fails closed and does not persist a mixed snapshot", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        },
      } as any,
      errors: [{ scope: 1n, reason: "mock sync failure" }],
    })) as typeof AccountService.initializeWithEvents;

    const accountService = {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map(),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      },
    } as unknown as AccountService;

    await expect(
      syncAccountEvents(
        accountService,
        samplePool(),
        [{ pool: samplePool()[0].address, symbol: "ETH" }],
        11155111,
        {
          skip: false,
          force: true,
          silent: true,
          isJson: false,
          isVerbose: false,
          errorLabel: "Sync",
          dataService: {} as any,
          mnemonic: MNEMONIC,
        },
      ),
    ).rejects.toMatchObject({
      category: "RPC",
      retryable: true,
    });

    expect(loadAccount(11155111)).toBeNull();
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("saved account without forceSync skips sync and returns service directly", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const fakeAccount = {
      poolAccounts: new Map(),
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    };
    saveAccount(11155111, fakeAccount);

    const mockDataService = {} as any;

    const service = await initializeAccountService(
      mockDataService,
      MNEMONIC,
      samplePool(),
      11155111,
      false,  // forceSync = false
      true,
      false
    );

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(AccountService);
  });
});
