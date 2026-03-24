import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";
import {
  ACCOUNT_FILE_VERSION,
  needsLegacyAccountRebuild,
  isSyncFresh,
  loadAccount,
  saveAccount,
  serialize,
  deserialize,
  initializeAccountService,
  initializeAccountServiceWithState,
} from "../../src/services/account.ts";
import { CLIError } from "../../src/utils/errors.ts";

const MNEMONIC = "test test test test test test test test test test test junk";
const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;

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

describe("account persistence", () => {
  afterEach(() => {
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
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

    saveAccount(11155111, { poolAccounts: new Map() });
    expect(needsLegacyAccountRebuild(11155111)).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /*  initializeAccountService — saved-account paths                   */
  /* ---------------------------------------------------------------- */

  test("saved account + forceSync + strictSync=true fails closed on event sync failure", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    // Write a saved account file so the saved-account path is triggered
    const fakeAccount = { poolAccounts: new Map() };
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

    // Write a saved account file
    const fakeAccount = { poolAccounts: new Map() };
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
      expect(stderrWrites.some((w) => w.includes("Warning: sync failed"))).toBe(true);
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

  test("saved account without forceSync skips sync and returns service directly", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const fakeAccount = { poolAccounts: new Map() };
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
