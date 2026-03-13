/**
 * Success-path integration tests for read-only commands.
 *
 * Uses a local ASP fixture HTTP server (separate process) so that `activity`,
 * `stats`, and `status --check-asp` can be exercised through their success
 * paths without a live ASP.  The `pools` command additionally requires RPC
 * reads, so for pools we verify the error shifts from ASP -> RPC when the
 * fixture is active.
 *
 * Addresses audit finding 2: "Read-only commands are mostly validated through
 * offline failure behavior, not successful payload correctness."
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await launchFixtureServer();
});

afterAll(() => {
  killFixtureServer(fixture);
});

function fixtureEnv() {
  return { PRIVACY_POOLS_ASP_HOST: fixture.url };
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
  test("pools --json --chain sepolia: ASP fixture reachable, RPC fails silently per-pool", () => {
    // pools calls fetchPoolsStats (ASP) then does on-chain RPC reads per pool.
    // With the fixture server handling ASP and no live RPC, the ASP fetch
    // succeeds (returns pool entries) but each pool's RPC metadata read fails.
    // The command returns success: true with empty pools (entries silently
    // dropped), proving the fixture integration works — without the fixture
    // the command would throw an ASP error instead.
    const result = runCli(
      ["--json", "--chain", "sepolia", "pools"],
      {
        home: createTempHome(),
        timeoutMs: 15_000,
        env: { ...fixtureEnv(), PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9" },
      },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      pools: unknown[];
    }>(result.stdout);

    expect(json.success).toBe(true);
    // Pools array is empty because RPC reads failed for each entry,
    // but the command didn't throw an ASP error — proof the fixture served data.
    expect(Array.isArray(json.pools)).toBe(true);
  });

  test("pools <asset> keeps wallet-state warnings concise when RPC log methods are unavailable", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

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
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

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
