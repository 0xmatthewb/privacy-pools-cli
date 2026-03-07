import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "../../src/config/chains.ts";
import { serialize } from "../../src/services/account.ts";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import {
  launchFixtureServer,
  killFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import {
  killSyncGateRpcServer,
  launchSyncGateRpcServer,
  type SyncGateRpcServer,
} from "../helpers/sync-gate-rpc-server.ts";

const chainConfig = CHAINS.sepolia;
const mockPoolAddress = "0x1234567890abcdef1234567890abcdef12345678" as const;
const mockScope = 12345n;

let fixture: FixtureServer;
let rpcServer: SyncGateRpcServer;

function seedCachedAccount(home: string): void {
  const accountsDir = join(home, ".privacy-pools", "accounts");
  mkdirSync(accountsDir, { recursive: true });
  writeFileSync(
    join(accountsDir, `${chainConfig.id}.json`),
    serialize({ poolAccounts: new Map() }),
    "utf8"
  );
}

function testEnv() {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
  };
}

beforeAll(async () => {
  fixture = await launchFixtureServer();
  rpcServer = await launchSyncGateRpcServer({
    chainId: chainConfig.id,
    entrypoint: chainConfig.entrypoint,
    poolAddress: mockPoolAddress,
    scope: mockScope,
  });
});

afterAll(() => {
  killSyncGateRpcServer(rpcServer);
  killFixtureServer(fixture);
});

describe("accounts/history --no-sync", () => {
  test("accounts --no-sync succeeds from cached state when log RPC is unavailable", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");
    seedCachedAccount(home);

    const withoutFlag = runCli(
      ["--json", "--chain", "sepolia", "accounts"],
      { home, timeoutMs: 20_000, env: testEnv() }
    );
    expect(withoutFlag.status).toBe(3);
    const withoutFlagJson = parseJsonOutput<{
      success: boolean;
      error: { category: string };
    }>(withoutFlag.stdout);
    expect(withoutFlagJson.success).toBe(false);
    expect(withoutFlagJson.error.category).toBe("RPC");

    const withFlag = runCli(
      ["--json", "--chain", "sepolia", "accounts", "--no-sync"],
      { home, timeoutMs: 20_000, env: testEnv() }
    );
    expect(withFlag.status).toBe(0);
    const withFlagJson = parseJsonOutput<{
      success: boolean;
      chain: string;
      accounts: unknown[];
      balances: unknown[];
    }>(withFlag.stdout);
    expect(withFlagJson.success).toBe(true);
    expect(withFlagJson.chain).toBe("sepolia");
    expect(withFlagJson.accounts).toEqual([]);
    expect(Array.isArray(withFlagJson.balances)).toBe(true);
  }, 30_000);

  test("history --no-sync succeeds from cached state when log RPC is unavailable", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");
    seedCachedAccount(home);

    const withoutFlag = runCli(
      ["--json", "--chain", "sepolia", "history"],
      { home, timeoutMs: 20_000, env: testEnv() }
    );
    expect(withoutFlag.status).toBe(3);
    const withoutFlagJson = parseJsonOutput<{
      success: boolean;
      error: { category: string };
    }>(withoutFlag.stdout);
    expect(withoutFlagJson.success).toBe(false);
    expect(withoutFlagJson.error.category).toBe("RPC");

    const withFlag = runCli(
      ["--json", "--chain", "sepolia", "history", "--no-sync"],
      { home, timeoutMs: 20_000, env: testEnv() }
    );
    expect(withFlag.status).toBe(0);
    const withFlagJson = parseJsonOutput<{
      success: boolean;
      chain: string;
      events: unknown[];
    }>(withFlag.stdout);
    expect(withFlagJson.success).toBe(true);
    expect(withFlagJson.chain).toBe("sepolia");
    expect(withFlagJson.events).toEqual([]);
  }, 30_000);
});
