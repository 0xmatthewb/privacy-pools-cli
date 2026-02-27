import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { initializeAccountService } from "../../src/services/account.ts";

const MNEMONIC = "test test test test test test test test test test test junk";
const ORIGINAL_HOME_OVERRIDE = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;

function isolatedHome(): string {
  return mkdtempSync(join(tmpdir(), "pp-account-service-test-"));
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
    expect(typeof service).toBe("object");
  });
});
