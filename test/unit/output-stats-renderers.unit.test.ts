/**
 * Unit tests for the stats output renderers: renderGlobalStats, renderPoolStats.
 * Follows the parity pattern established by output-reporting-renderers.unit.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import {
  renderGlobalStats,
  renderPoolStats,
  type GlobalStatsRenderData,
  type PoolStatsRenderData,
  type ChainStatsEntry,
} from "../../src/output/stats.ts";
import type { TimeBasedStatistics } from "../../src/types.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

// ── Stub data ────────────────────────────────────────────────────────────────

const STUB_STATS: TimeBasedStatistics = {
  tvlUsd: "5000000",
  avgDepositSizeUsd: "10000",
  totalDepositsCount: 500,
  totalWithdrawalsCount: 150,
};

const STUB_GLOBAL_STATS: GlobalStatsRenderData = {
  mode: "global-stats",
  chain: "sepolia",
  cacheTimestamp: "2025-01-01T00:00:00.000Z",
  allTime: STUB_STATS,
  last24h: { ...STUB_STATS, totalDepositsCount: 10 },
};

const STUB_POOL_STATS: PoolStatsRenderData = {
  mode: "pool-stats",
  chain: "sepolia",
  asset: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  scope: "42",
  cacheTimestamp: "2025-01-01T00:00:00.000Z",
  allTime: STUB_STATS,
  last24h: null,
};

// ── renderGlobalStats parity ─────────────────────────────────────────────────

describe("renderGlobalStats parity", () => {
  test("JSON mode: emits global-stats envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderGlobalStats(ctx, STUB_GLOBAL_STATS));

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("pools");
    expect(json.action).toBe("stats");
    expect(json.operation).toBe("pools.stats");
    expect(json.chain).toBe("sepolia");
    expect(json.cacheTimestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(json.allTime).toEqual(expect.any(Object));
    expect(json.last24h).toEqual(expect.any(Object));
    expect(stderr).toBe("");
  });

  test("JSON mode: includes chains array when present", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_GLOBAL_STATS, chains: ["sepolia", "mainnet"] };
    const { stdout } = captureOutput(() => renderGlobalStats(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.chains).toEqual(["sepolia", "mainnet"]);
  });

  test("JSON mode: includes perChain when present", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const perChain: ChainStatsEntry[] = [
      { chain: "sepolia", cacheTimestamp: null, allTime: STUB_STATS, last24h: null },
    ];
    const data = { ...STUB_GLOBAL_STATS, perChain };
    const { stdout } = captureOutput(() => renderGlobalStats(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.perChain.length).toBe(1);
  });

  test("human mode: emits stats table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderGlobalStats(ctx, STUB_GLOBAL_STATS));

    expect(stdout).toBe("");
    expect(stderr).toContain("Global statistics (sepolia)");
    expect(stderr).toContain("Current TVL");
    expect(stderr).toContain("Total Deposits");
  });

  test("human mode: renders per-chain sections when perChain present", () => {
    const ctx = createOutputContext(makeMode());
    const perChain: ChainStatsEntry[] = [
      { chain: "sepolia", cacheTimestamp: null, allTime: STUB_STATS, last24h: null },
      { chain: "mainnet", cacheTimestamp: null, allTime: STUB_STATS, last24h: null },
    ];
    const data = { ...STUB_GLOBAL_STATS, perChain };
    const { stderr } = captureOutput(() => renderGlobalStats(ctx, data));

    expect(stderr).toContain("Global statistics (sepolia)");
    expect(stderr).toContain("Global statistics (mainnet)");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderGlobalStats(ctx, STUB_GLOBAL_STATS));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderPoolStats parity ───────────────────────────────────────────────────

describe("renderPoolStats parity", () => {
  test("JSON mode: emits pool-stats envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderPoolStats(ctx, STUB_POOL_STATS));

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("pools");
    expect(json.action).toBe("stats");
    expect(json.operation).toBe("pools.stats");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.pool).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.cacheTimestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(json.allTime).toEqual(expect.any(Object));
    expect(json.last24h).toBeNull();
    expect(stderr).toBe("");
  });

  test("JSON mode: handles null allTime and last24h", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_POOL_STATS, allTime: null, last24h: null };
    const { stdout } = captureOutput(() => renderPoolStats(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.allTime).toBeNull();
    expect(json.last24h).toBeNull();
  });

  test("human mode: emits pool stats header and table", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderPoolStats(ctx, STUB_POOL_STATS));

    expect(stdout).toBe("");
    expect(stderr).toContain("Pool statistics for ETH on sepolia");
    expect(stderr).toContain("Current TVL");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderPoolStats(ctx, STUB_POOL_STATS));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});
