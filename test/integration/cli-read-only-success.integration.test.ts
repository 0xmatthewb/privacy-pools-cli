/**
 * Success-path integration tests for read-only commands.
 *
 * Uses a local ASP fixture HTTP server (separate process) so that `activity`,
 * `stats`, `pools`, and `status --check-asp` can be exercised through their
 * success paths without a live ASP.
 *
 * Addresses audit finding 2: "Read-only commands are mostly validated through
 * offline failure behavior, not successful payload correctness."
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createSeededHome,
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import {
  launchFixtureServer,
  killFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await launchFixtureServer();
});

afterAll(async () => {
  await killFixtureServer(fixture);
});

function fixtureEnv() {
  return { PRIVACY_POOLS_ASP_HOST: fixture.url };
}

function multiChainFixtureEnv() {
  return {
    ...fixtureEnv(),
    PRIVACY_POOLS_RPC_URL_ETHEREUM: fixture.url,
    PRIVACY_POOLS_RPC_URL_MAINNET: fixture.url,
    PRIVACY_POOLS_RPC_URL_ARBITRUM: fixture.url,
    PRIVACY_POOLS_RPC_URL_OPTIMISM: fixture.url,
  };
}

// ── activity ─────────────────────────────────────────────────────────────────

describe("activity success path", () => {
  test("activity --json --chain sepolia returns valid events payload", () => {
    const result = runCli(
      ["--json", "--chain", "sepolia", "activity"],
      { home: createTempHome(), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      schemaVersion: string;
      mode: string;
      chain: string;
      chainFiltered: boolean;
      events: Array<{ type: string; txHash: string | null }>;
      page: number;
      perPage: number;
      total: number | null;
      totalPages: number | null;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.mode).toBe("global-activity");
    expect(json.chain).toBe("sepolia");
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events.length).toBeGreaterThan(0);
    expect(json.events[0]).toHaveProperty("type");
    expect(json.events[0]).toHaveProperty("txHash");
    expect(typeof json.page).toBe("number");
    expect(typeof json.perPage).toBe("number");
    // Chain-filtered global activity nulls pagination totals (F-03)
    expect(json.total).toBeNull();
    expect(json.totalPages).toBeNull();
    expect(json.chainFiltered).toBe(true);
    expect(result.stderr.trim()).toBe("");
  });

  test("activity --json --chain sepolia --page 1 --limit 5 reflects pagination", () => {
    const result = runCli(
      ["--json", "--chain", "sepolia", "activity", "--page", "1", "--limit", "5"],
      { home: createTempHome(), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      page: number;
      perPage: number;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.page).toBe(1);
    expect(json.perPage).toBe(5);
  });
});

// ── stats ────────────────────────────────────────────────────────────────────

describe("stats global success path", () => {
  test("stats --json returns valid global statistics", () => {
    const result = runCli(
      ["--json", "stats"],
      { home: createTempHome(), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      schemaVersion: string;
      mode: string;
      cacheTimestamp: string | null;
      allTime: {
        tvl?: string;
        totalDepositsCount?: number;
        totalDepositsValue?: string;
        totalWithdrawalsCount?: number;
      } | null;
      last24h: Record<string, unknown> | null;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.mode).toBe("global-stats");
    expect(json.cacheTimestamp).not.toBeNull();
    // allTime statistics structure
    expect(json.allTime).not.toBeNull();
    expect(typeof json.allTime!.totalDepositsCount).toBe("number");
    expect(typeof json.allTime!.tvl).toBe("string");
    expect(json.last24h).not.toBeNull();
    expect(result.stderr.trim()).toBe("");
  });

  test("stats global --json returns same structure", () => {
    const result = runCli(
      ["--json", "stats", "global"],
      { home: createTempHome(), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      mode: string;
      allTime: Record<string, unknown> | null;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.mode).toBe("global-stats");
    expect(json.allTime).not.toBeNull();
  });

  test("stats global --json --chain rejects with INPUT error", () => {
    const result = runCli(
      ["--json", "--chain", "sepolia", "stats", "global"],
      { home: createTempHome(), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });
});

// ── pools ────────────────────────────────────────────────────────────────────

describe("pools with fixture server", () => {
  test("fixture pools-stats endpoints stay chain-scoped", async () => {
    for (const chainId of [1, 10, 42161, 11155111, 11155420]) {
      const response = await fetch(`${fixture.url}/${chainId}/public/pools-stats`);
      expect(response.ok).toBe(true);

      const payload = await response.json() as Array<{ chainId?: number | string }>;
      expect(Array.isArray(payload)).toBe(true);
      expect(payload.length).toBeGreaterThan(0);
      expect(payload.every((entry) => Number(entry.chainId) === chainId)).toBe(true);
    }
  });

  test("pools --json --chain sepolia returns a non-empty payload", () => {
    const result = runCli(
      ["--json", "--chain", "sepolia", "pools"],
      {
        home: createTempHome(),
        timeoutMs: 15_000,
        env: { ...fixtureEnv(), PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url },
      },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      chain?: string;
      pools: Array<{
        asset?: string;
        tokenAddress?: string;
        pool?: string;
        scope?: number | string;
        minimumDeposit?: string;
        vettingFeeBPS?: string;
        maxRelayFeeBPS?: string;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(Array.isArray(json.pools)).toBe(true);
    expect(json.pools.length).toBeGreaterThan(0);
    expect(json.pools[0]).toMatchObject({
      asset: "ETH",
      tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      pool: "0x1234567890AbcdEF1234567890aBcdef12345678",
      scope: "12345",
      minimumDeposit: "1000000000000000",
      vettingFeeBPS: "50",
      maxRelayFeeBPS: "250",
    });
    expect(result.stderr.trim()).toBe("");
  });

  test("pools --json exercises a realistic default multi-mainnet success path", () => {
    const result = runCli(
      ["--json", "pools"],
      {
        home: createTempHome(),
        timeoutMs: 15_000,
        env: multiChainFixtureEnv(),
      },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      allChains?: boolean;
      warnings?: Array<{ chain?: string }> | null;
      chains?: Array<{ chain?: string; pools?: number; error?: string | null }>;
      pools: Array<{ chain?: string; asset?: string; pool?: string }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.allChains).toBe(true);
    expect(json.warnings ?? null).toBeNull();
    expect(json.chains).toEqual([
      { chain: "mainnet", pools: 1, error: null },
      { chain: "arbitrum", pools: 1, error: null },
      { chain: "optimism", pools: 1, error: null },
    ]);
    expect(json.pools).toHaveLength(3);
    expect([...json.pools.map((entry) => entry.chain)].sort()).toEqual([
      "arbitrum",
      "mainnet",
      "optimism",
    ]);
  });

  test("pools --json --chain sepolia returns an RPC envelope when all pool reads fail", () => {
    const result = runCli(
      ["--json", "--chain", "sepolia", "pools"],
      {
        home: createTempHome(),
        timeoutMs: 15_000,
        env: { ...fixtureEnv(), PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9" },
      },
    );
    expect(result.status).toBe(3);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; code?: string };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.error.category).toBe("RPC");
    expect(json.error.code).toBe("RPC_POOL_RESOLUTION_FAILED");
    expect(result.stderr.trim()).toBe("");
  });

  test("pools <asset> keeps wallet-state warnings concise when RPC log methods are unavailable", () => {
    const home = createSeededHome("sepolia");

    const result = runCli(
      ["--chain", "sepolia", "--rpc-url", fixture.url, "pools", "ETH"],
      {
        home,
        timeoutMs: 15_000,
        env: fixtureEnv(),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("ETH Pool on sepolia");
    expect(result.stderr).toContain("Could not load your wallet state from onchain data right now.");
    expect(result.stderr).toContain("privacy-pools status --check --chain sepolia");
    expect(result.stderr).not.toContain("Method not found");
    expect(result.stderr).not.toContain("eth_getLogs");
    expect(result.stderr).not.toContain("viem/");
  });
});

// ── status health check ──────────────────────────────────────────────────────

describe("status health check success path", () => {
  test("status --json with fixture server reports aspLive true", () => {
    const home = createSeededHome("sepolia");

    const result = runCli(
      ["--json", "--rpc-url", "http://127.0.0.1:9", "status"],
      { home, timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      aspLive: boolean;
      rpcLive: boolean;
    }>(result.stdout);

    expect(json.success).toBe(true);
    // ASP liveness check should succeed against fixture
    expect(json.aspLive).toBe(true);
    // RPC is offline (127.0.0.1:9)
    expect(json.rpcLive).toBe(false);
  });
});
