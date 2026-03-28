import { afterEach, describe, expect, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import {
  initializeAccountService,
  loadAccount,
  loadSyncMeta,
  saveAccount,
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
});
