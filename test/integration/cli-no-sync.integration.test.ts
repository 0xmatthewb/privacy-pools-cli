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

const mainnetChainConfig = CHAINS.mainnet;
const arbitrumChainConfig = CHAINS.arbitrum;
const optimismChainConfig = CHAINS.optimism;
const sepoliaChainConfig = CHAINS.sepolia;
const opSepoliaChainConfig = CHAINS["op-sepolia"];
const mockPoolAddress = "0x1234567890abcdef1234567890abcdef12345678" as const;
const mockScope = 12345n;

let fixture: FixtureServer;
let rpcServers: Record<string, SyncGateRpcServer>;

function seedCachedAccount(home: string): void {
  const accountsDir = join(home, ".privacy-pools", "accounts");
  mkdirSync(accountsDir, { recursive: true });
  writeFileSync(
    join(accountsDir, `${sepoliaChainConfig.id}.json`),
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

function seedDetailedCachedAccount(home: string, chainId: number = sepoliaChainConfig.id): void {
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
    join(accountsDir, `${chainId}.json`),
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
    PRIVACY_POOLS_RPC_URL_ETHEREUM: rpcServers.mainnet.url,
    PRIVACY_POOLS_RPC_URL_ARBITRUM: rpcServers.arbitrum.url,
    PRIVACY_POOLS_RPC_URL_OPTIMISM: rpcServers.optimism.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServers.sepolia.url,
    PRIVACY_POOLS_RPC_URL_OP_SEPOLIA: rpcServers["op-sepolia"].url,
  };
}

beforeAll(async () => {
  fixture = await launchFixtureServer();
  rpcServers = {
    mainnet: await launchSyncGateRpcServer({
      chainId: mainnetChainConfig.id,
      entrypoint: mainnetChainConfig.entrypoint,
      poolAddress: mockPoolAddress,
      scope: mockScope,
    }),
    arbitrum: await launchSyncGateRpcServer({
      chainId: arbitrumChainConfig.id,
      entrypoint: arbitrumChainConfig.entrypoint,
      poolAddress: mockPoolAddress,
      scope: mockScope,
    }),
    optimism: await launchSyncGateRpcServer({
      chainId: optimismChainConfig.id,
      entrypoint: optimismChainConfig.entrypoint,
      poolAddress: mockPoolAddress,
      scope: mockScope,
    }),
    sepolia: await launchSyncGateRpcServer({
      chainId: sepoliaChainConfig.id,
      entrypoint: sepoliaChainConfig.entrypoint,
      poolAddress: mockPoolAddress,
      scope: mockScope,
    }),
    "op-sepolia": await launchSyncGateRpcServer({
      chainId: opSepoliaChainConfig.id,
      entrypoint: opSepoliaChainConfig.entrypoint,
      poolAddress: mockPoolAddress,
      scope: mockScope,
    }),
  };
});

afterAll(() => {
  for (const server of Object.values(rpcServers)) {
    killSyncGateRpcServer(server);
  }
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
      poiRequiredCount: number;
      declinedCount: number;
      unknownCount: number;
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
    expect(json.poiRequiredCount).toBe(0);
    expect(json.declinedCount).toBe(0);
    expect(json.unknownCount).toBe(0);
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
    expect(json.nextActions?.map((action) => action.command)).toEqual(["accounts"]);
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
    expect(json.accounts[0]?.status).toBe("pending");
    expect(json.accounts[0]?.value).toBe("2000000000000000000");
    expect(json.balances).toBeUndefined();
    expect(json.nextActions).toHaveLength(1);
    expect(json.nextActions?.[0]?.command).toBe("accounts");
    expect(json.nextActions?.[0]?.options).toEqual({ agent: true, chain: "sepolia", pendingOnly: true });
  }, 30_000);

  test("accounts --no-sync --pending-only aggregates mainnets by default and surfaces partial-failure warnings", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");
    seedDetailedCachedAccount(home, mainnetChainConfig.id);
    seedDetailedCachedAccount(home, arbitrumChainConfig.id);

    const result = runCli(
      ["--agent", "accounts", "--no-sync", "--pending-only"],
      {
        home,
        timeoutMs: 30_000,
        env: {
          ...testEnv(),
          PRIVACY_POOLS_ASP_HOST_OPTIMISM: "http://127.0.0.1:9",
        },
      },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      chain: string;
      chains: string[];
      warnings?: Array<{ chain: string; category: string; message: string }>;
      pendingCount: number;
      accounts: Array<{ poolAccountId: string; aspStatus: string; chain: string; chainId: number }>;
      balances?: unknown[];
      nextActions?: Array<{ command: string; options?: Record<string, boolean | string> }>;
    }>(result.stdout);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("all-mainnets");
    expect(json.chains).toEqual(["mainnet", "arbitrum", "optimism"]);
    expect(json.pendingCount).toBe(2);
    expect(json.accounts).toHaveLength(2);
    expect(json.accounts.every((account) => account.aspStatus === "pending")).toBe(true);
    expect(json.accounts.map((account) => account.chain)).toEqual(["mainnet", "arbitrum"]);
    expect(json.accounts.map((account) => account.chainId)).toEqual([1, 42161]);
    expect(json.accounts.map((account) => account.poolAccountId)).toEqual(["PA-2", "PA-2"]);
    expect(json.balances).toBeUndefined();
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings?.[0]?.chain).toBe("optimism");
    expect(json.nextActions).toEqual([
      {
        command: "accounts",
        reason: "Poll again until pending deposits leave ASP review, then confirm whether they were approved, declined, or need Proof of Association.",
        when: "has_pending",
        options: { agent: true, pendingOnly: true },
      },
    ]);
  }, 30_000);

  test("accounts --no-sync --all-chains --summary includes testnets and chain metadata", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");
    for (const chainId of [
      mainnetChainConfig.id,
      arbitrumChainConfig.id,
      optimismChainConfig.id,
      sepoliaChainConfig.id,
      opSepoliaChainConfig.id,
    ]) {
      seedDetailedCachedAccount(home, chainId);
    }

    const result = runCli(
      ["--agent", "accounts", "--no-sync", "--all-chains", "--summary"],
      { home, timeoutMs: 30_000, env: testEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      chain: string;
      allChains?: boolean;
      chains: string[];
      pendingCount: number;
      approvedCount: number;
      poiRequiredCount: number;
      declinedCount: number;
      unknownCount: number;
      spentCount: number;
      exitedCount: number;
      balances: Array<{ asset: string; balance: string; poolAccounts: number; chain: string; chainId: number }>;
      nextActions?: Array<{ command: string; options?: Record<string, boolean | string> }>;
    }>(result.stdout);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("all-chains");
    expect(json.allChains).toBe(true);
    expect(json.chains).toEqual(["mainnet", "arbitrum", "optimism", "sepolia", "op-sepolia"]);
    expect(json.pendingCount).toBe(5);
    expect(json.approvedCount).toBe(5);
    expect(json.poiRequiredCount).toBe(0);
    expect(json.declinedCount).toBe(0);
    expect(json.unknownCount).toBe(0);
    expect(json.spentCount).toBe(5);
    expect(json.exitedCount).toBe(5);
    expect(json.balances).toHaveLength(5);
    expect(json.balances.map((balance) => balance.chain)).toEqual([
      "mainnet",
      "arbitrum",
      "optimism",
      "sepolia",
      "op-sepolia",
    ]);
    expect(json.balances.map((balance) => balance.chainId)).toEqual([1, 42161, 10, 11155111, 11155420]);
    expect(json.balances.every((balance) => balance.asset === "ETH")).toBe(true);
    expect(json.balances.every((balance) => balance.balance === "3000000000000000000")).toBe(true);
    expect(json.balances.every((balance) => balance.poolAccounts === 2)).toBe(true);
    expect(json.nextActions).toEqual([
      {
        command: "accounts",
        reason: "Poll again until pending deposits leave ASP review, then confirm whether they were approved, declined, or need Proof of Association.",
        when: "has_pending",
        options: { agent: true, allChains: true, pendingOnly: true },
      },
    ]);
  }, 30_000);
});
