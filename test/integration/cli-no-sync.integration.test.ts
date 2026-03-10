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

function commitment(
  label: bigint,
  hash: bigint,
  value: bigint,
  blockNumber: bigint,
  txHash: `0x${string}`,
) {
  return {
    label,
    hash,
    value,
    blockNumber,
    txHash,
    nullifier: (label + 1000n) as any,
    secret: (label + 2000n) as any,
  };
}

function seedDetailedCachedAccount(home: string): void {
  const accountsDir = join(home, ".privacy-pools", "accounts");
  mkdirSync(accountsDir, { recursive: true });

  const approved = commitment(
    1n,
    11n,
    1_000_000_000_000_000_000n,
    10n,
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  );
  const pending = commitment(
    2n,
    22n,
    2_000_000_000_000_000_000n,
    20n,
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  );
  const spentDeposit = commitment(
    3n,
    33n,
    5_000_000_000_000_000_000n,
    30n,
    "0x3333333333333333333333333333333333333333333333333333333333333333",
  );
  const spentChild = commitment(
    3n,
    333n,
    0n,
    31n,
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const exited = commitment(
    4n,
    44n,
    4_000_000_000_000_000_000n,
    40n,
    "0x4444444444444444444444444444444444444444444444444444444444444444",
  );

  writeFileSync(
    join(accountsDir, `${chainConfig.id}.json`),
    serialize({
      masterKeys: [1n, 2n],
      poolAccounts: new Map([
        [mockScope, [
          { label: approved.label as any, deposit: approved, children: [] },
          { label: pending.label as any, deposit: pending, children: [] },
          { label: spentDeposit.label as any, deposit: spentDeposit, children: [spentChild] },
          {
            label: exited.label as any,
            deposit: exited,
            children: [],
            ragequit: {
              ragequitter: "0x1111111111111111111111111111111111111111",
              commitment: exited.hash as any,
              label: exited.label as any,
              value: exited.value,
              blockNumber: 444n,
              transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          },
        ]],
      ]),
    }),
    "utf8",
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

  test("accounts --no-sync --summary reports full cached status counts", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");
    seedDetailedCachedAccount(home);

    const result = runCli(
      ["--json", "--chain", "sepolia", "accounts", "--no-sync", "--summary"],
      { home, timeoutMs: 20_000, env: testEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      chain: string;
      pendingCount: number;
      approvedCount: number;
      spendableCount: number;
      spentCount: number;
      exitedCount: number;
      balances: Array<{ asset: string; balance: string; usdValue: string | null; poolAccounts: number }>;
      nextActions?: Array<{ command: string }>;
      accounts?: unknown[];
    }>(result.stdout);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.accounts).toBeUndefined();
    expect(json.pendingCount).toBe(1);
    expect(json.approvedCount).toBe(1);
    expect(json.spendableCount).toBe(2);
    expect(json.spentCount).toBe(1);
    expect(json.exitedCount).toBe(1);
    expect(json.balances).toEqual([
      {
        asset: "ETH",
        balance: "3000000000000000000",
        usdValue: null,
        poolAccounts: 2,
      },
    ]);
    expect(json.nextActions?.map((action) => action.command)).toEqual(["withdraw", "accounts"]);
  }, 30_000);

  test("accounts --no-sync --pending-only filters cached pending approvals", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");
    seedDetailedCachedAccount(home);

    const result = runCli(
      ["--json", "--chain", "sepolia", "accounts", "--no-sync", "--pending-only"],
      { home, timeoutMs: 20_000, env: testEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      chain: string;
      pendingCount: number;
      accounts: Array<{ poolAccountId: string; aspStatus: string; status: string; value: string }>;
      balances?: unknown[];
      nextActions?: Array<{ command: string; options?: Record<string, boolean | string> }>;
    }>(result.stdout);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.pendingCount).toBe(1);
    expect(json.accounts).toHaveLength(1);
    expect(json.accounts[0]?.poolAccountId).toBe("PA-2");
    expect(json.accounts[0]?.aspStatus).toBe("pending");
    expect(json.accounts[0]?.status).toBe("spendable");
    expect(json.accounts[0]?.value).toBe("2000000000000000000");
    expect(json.balances).toBeUndefined();
    expect(json.nextActions).toHaveLength(1);
    expect(json.nextActions?.[0]?.command).toBe("accounts");
    expect(json.nextActions?.[0]?.options).toEqual({ agent: true, chain: "sepolia", pendingOnly: true });
  }, 30_000);
});
