import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import {
  initializeAccountService,
  initializeAccountServiceWithState,
  loadAccount,
  loadSyncMeta,
  saveAccount,
  serialize,
} from "../../src/services/account.ts";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";

const MNEMONIC = "test test test test test test test test test test test junk";
const ORIGINAL_HOME_OVERRIDE = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;

function isolatedHome(): string {
  return createTrackedTempDir("pp-account-service-test-");
}

function samplePool() {
  return [{
    chainId: 11155111,
    address: "0x0000000000000000000000000000000000000001",
    scope: 1n,
    deploymentBlock: 1n,
  }];
}

describe("account service strict sync behavior", () => {
  afterEach(() => {
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    if (ORIGINAL_HOME_OVERRIDE === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME_OVERRIDE;
    }
    cleanupTrackedTempDirs();
  });

  test("strictSync=true fails closed when initializeWithEvents fails", async () => {
    process.env.PRIVACY_POOLS_HOME = isolatedHome();

    AccountService.initializeWithEvents = (async () => {
      throw new Error("forced initializeWithEvents failure");
    }) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountService(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        false,
        true,
        true
      )
    ).rejects.toMatchObject({
      category: "RPC",
      message: expect.stringContaining("Failed to initialize account"),
    });
  });

  test("strictSync=true fails closed when initializeWithEvents returns partial pool errors", async () => {
    process.env.PRIVACY_POOLS_HOME = isolatedHome();

    AccountService.initializeWithEvents = (async () => ({
      account: { account: { poolAccounts: new Map() } } as any,
      errors: [{ scope: 1n, reason: "mock rpc timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountService(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        false,
        true,
        true
      )
    ).rejects.toMatchObject({
      category: "RPC",
      message: expect.stringContaining("Failed to initialize account from onchain events"),
    });
  });

  test("strictSync=false falls back to empty account service", async () => {
    process.env.PRIVACY_POOLS_HOME = isolatedHome();

    AccountService.initializeWithEvents = (async () => {
      throw new Error("forced initializeWithEvents failure");
    }) as typeof AccountService.initializeWithEvents;

    const service = await initializeAccountService(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      false,
      true,
      false
    );

    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(AccountService);
    expect(service.account.poolAccounts.size).toBe(0);
    expect(loadAccount(11155111)).toBeNull();
    expect(loadSyncMeta(11155111)).toBeNull();
  });

  test("forceSync rebuilds targeted scopes without dropping untouched ones", async () => {
    process.env.PRIVACY_POOLS_HOME = isolatedHome();

    saveAccount(11155111, {
      masterKeys: [1n, 2n],
      poolAccounts: new Map([
        [1n, [{ label: 10n }]],
        [2n, [{ label: 20n }]],
      ]),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    });

    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map([[1n, [{ label: 11n }]]]),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        },
      } as any,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const service = await initializeAccountService(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      true,
      true,
      true,
    );

    expect(service.account.poolAccounts.get(1n)).toEqual([{ label: 11n }]);
    expect(service.account.poolAccounts.get(2n)).toEqual([{ label: 20n }]);
    expect(loadAccount(11155111)?.poolAccounts.get(1n)).toEqual([{ label: 11n }]);
    expect(loadAccount(11155111)?.poolAccounts.get(2n)).toEqual([{ label: 20n }]);
    expect(loadSyncMeta(11155111)).toEqual({
      lastSyncTime: expect.any(Number),
    });
  });

  test("forceSync preserves an existing targeted scope when rebuild returns it empty", async () => {
    process.env.PRIVACY_POOLS_HOME = isolatedHome();

    saveAccount(11155111, {
      masterKeys: [1n, 2n],
      poolAccounts: new Map([
        [1n, [{ label: 10n }]],
        [2n, [{ label: 20n }]],
      ]),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    });

    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map(),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        },
      } as any,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const service = await initializeAccountService(
      {} as any,
      MNEMONIC,
      samplePool(),
      11155111,
      true,
      true,
      true,
    );

    expect(service.account.poolAccounts.get(1n)).toEqual([{ label: 10n }]);
    expect(service.account.poolAccounts.get(2n)).toEqual([{ label: 20n }]);
    expect(loadAccount(11155111)?.poolAccounts.get(1n)).toEqual([{ label: 10n }]);
    expect(loadAccount(11155111)?.poolAccounts.get(2n)).toEqual([{ label: 20n }]);
    expect(loadSyncMeta(11155111)).toEqual({
      lastSyncTime: expect.any(Number),
    });
  });

  test("forceSync warns when it preserves richer saved Pool Account scope entries", async () => {
    process.env.PRIVACY_POOLS_HOME = isolatedHome();

    saveAccount(11155111, {
      masterKeys: [1n, 2n],
      poolAccounts: new Map([
        [
          1n,
          [
            { label: 10n },
            { label: 11n },
          ],
        ],
      ]),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    });

    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: {
          masterKeys: [1n, 2n],
          poolAccounts: new Map([[1n, [{ label: 12n }]]]),
          creationTimestamp: 0n,
          lastUpdateTimestamp: 0n,
        },
      } as any,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const service = await initializeAccountService(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        true,
        false,
        false,
      );

      expect(service.account.poolAccounts.get(1n)).toEqual([
        { label: 10n },
        { label: 11n },
      ]);
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(stderrWrites.join("")).toContain(
      "keeping the saved account entries for scope 1",
    );
  });

  test("legacy refresh strictSync=true fails closed when rebuild returns partial pool errors", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    mkdirSync(join(home, "accounts"), { recursive: true });
    writeFileSync(
      join(home, "accounts", "11155111.json"),
      serialize({ poolAccounts: new Map() }),
      "utf-8",
    );

    AccountService.initializeWithEvents = (async () => ({
      account: { account: { poolAccounts: new Map() } } as any,
      errors: [{ scope: 1n, reason: "legacy refresh timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountService(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        true,
        true,
        true,
      ),
    ).rejects.toMatchObject({
      category: "RPC",
      message: expect.stringContaining(
        "Failed to rebuild legacy account state from onchain events for 1 pool",
      ),
    });
  });

  test("legacy refresh strictSync=true wraps hard rebuild failures", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    mkdirSync(join(home, "accounts"), { recursive: true });
    writeFileSync(
      join(home, "accounts", "11155111.json"),
      serialize({ poolAccounts: new Map() }),
      "utf-8",
    );

    AccountService.initializeWithEvents = (async () => {
      throw new Error("forced legacy rebuild failure");
    }) as typeof AccountService.initializeWithEvents;

    await expect(
      initializeAccountService(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        true,
        true,
        true,
      ),
    ).rejects.toMatchObject({
      category: "RPC",
      message: expect.stringContaining(
        "Failed to rebuild legacy account state from onchain events",
      ),
    });
  });

  test("legacy refresh strictSync=false warns and throws a retryable stale-refresh error", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    mkdirSync(join(home, "accounts"), { recursive: true });
    writeFileSync(
      join(home, "accounts", "11155111.json"),
      serialize({ poolAccounts: new Map() }),
      "utf-8",
    );

    AccountService.initializeWithEvents = (async () => {
      throw new Error("forced legacy rebuild failure");
    }) as typeof AccountService.initializeWithEvents;

    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await expect(
        initializeAccountServiceWithState(
          {} as any,
          MNEMONIC,
          samplePool(),
          11155111,
          {
            allowLegacyAccountRebuild: true,
            suppressWarnings: false,
            strictSync: false,
          },
        ),
      ).rejects.toMatchObject({
        category: "RPC",
        retryable: true,
        message: expect.stringContaining(
          "Stored account state could not be refreshed safely",
        ),
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(
      stderrWrites.some((chunk) =>
        chunk.includes("Warning: legacy account rebuild failed"),
      ),
    ).toBe(true);
  });

  test("legacy refresh strictSync=false warns and returns a partial rebuilt state when rebuild reports pool errors", async () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    mkdirSync(join(home, "accounts"), { recursive: true });
    writeFileSync(
      join(home, "accounts", "11155111.json"),
      serialize({ poolAccounts: new Map() }),
      "utf-8",
    );

    const rebuiltAccount = {
      masterKeys: [1n, 2n],
      poolAccounts: new Map([[1n, [{ label: 11n }]]]),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
    } as any;
    const rebuiltService = new AccountService({} as any, {
      account: rebuiltAccount,
    });

    AccountService.initializeWithEvents = (async () => ({
      account: rebuiltService,
      errors: [{ scope: 1n, reason: "legacy refresh timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      const result = await initializeAccountServiceWithState(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        {
          allowLegacyAccountRebuild: true,
          suppressWarnings: false,
          strictSync: false,
        },
      );

      expect(result.accountService).toBe(rebuiltService);
      expect(result.rebuiltLegacyAccount).toBe(true);
      expect(result.skipImmediateSync).toBe(false);
      expect(result.legacyDeclinedLabels).toBeNull();
      expect(loadAccount(11155111)?.poolAccounts).toEqual(new Map());
      expect(loadSyncMeta(11155111)).toBeNull();
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(
      stderrWrites.some((chunk) =>
        chunk.includes("legacy account rebuild had partial failures"),
      ),
    ).toBe(true);
  });

  test("fresh initialization strictSync=false warns before falling back to an empty account", async () => {
    process.env.PRIVACY_POOLS_HOME = isolatedHome();

    AccountService.initializeWithEvents = (async () => {
      throw new Error("forced initializeWithEvents failure");
    }) as typeof AccountService.initializeWithEvents;

    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      const service = await initializeAccountService(
        {} as any,
        MNEMONIC,
        samplePool(),
        11155111,
        false,
        false,
        false,
      );

      expect(service).toBeInstanceOf(AccountService);
      expect(service.account.poolAccounts.size).toBe(0);
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(
      stderrWrites.some((chunk) =>
        chunk.includes("Warning: fresh account initialization failed, using empty account"),
      ),
    ).toBe(true);
  });
});
