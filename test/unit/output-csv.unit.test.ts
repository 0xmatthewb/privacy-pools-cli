/**
 * Unit tests for CSV output: printCsv utility and renderer CSV branches.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { printCsv } from "../../src/output/csv.ts";
import { printTable, setSuppressHeaders } from "../../src/utils/format.ts";
import { renderPoolsEmpty, renderPools, type PoolsRenderData } from "../../src/output/pools.ts";
import { renderAccountsNoPools, renderAccounts, type AccountPoolGroup } from "../../src/output/accounts.ts";
import { renderHistoryNoPools, renderHistory } from "../../src/output/history.ts";
import { renderActivity, type ActivityRenderData } from "../../src/output/activity.ts";
import { renderGlobalStats, renderPoolStats, type GlobalStatsRenderData, type PoolStatsRenderData } from "../../src/output/stats.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

function csvMode() {
  return makeMode({ isCsv: true, format: "csv" });
}

afterEach(() => {
  setSuppressHeaders(false);
  delete process.env.COLUMNS;
});

// ── printCsv utility ─────────────────────────────────────────────────────────

describe("printCsv", () => {
  test("writes header + rows to stdout", () => {
    const { stdout, stderr } = captureOutput(() =>
      printCsv(["Name", "Value"], [["Alice", "100"], ["Bob", "200"]]),
    );
    expect(stdout).toBe("Name,Value\nAlice,100\nBob,200\n");
    expect(stderr).toBe("");
  });

  test("escapes fields with commas", () => {
    const { stdout } = captureOutput(() =>
      printCsv(["Data"], [["hello, world"]]),
    );
    expect(stdout).toContain('"hello, world"');
  });

  test("escapes fields with double quotes", () => {
    const { stdout } = captureOutput(() =>
      printCsv(["Data"], [['say "hi"']]),
    );
    expect(stdout).toContain('"say ""hi"""');
  });

  test("strips ANSI codes from cells", () => {
    const { stdout } = captureOutput(() =>
      printCsv(["Data"], [["\x1B[31mred\x1B[0m"]]),
    );
    expect(stdout).toBe("Data\nred\n");
  });

  test("empty rows produces header-only output", () => {
    const { stdout } = captureOutput(() =>
      printCsv(["A", "B"], []),
    );
    expect(stdout).toBe("A,B\n");
  });

  test("suppresses headers when --no-header is active", () => {
    setSuppressHeaders(true);
    const { stdout } = captureOutput(() =>
      printCsv(["Name", "Value"], [["Alice", "100"], ["Bob", "200"]]),
    );
    expect(stdout).toBe("Alice,100\nBob,200\n");
  });

  test("emits empty stdout for zero-row CSV output when headers are suppressed", () => {
    setSuppressHeaders(true);
    const { stdout } = captureOutput(() =>
      printCsv(["A", "B"], []),
    );
    expect(stdout).toBe("");
  });
});

describe("printTable", () => {
  test("suppresses header rows in wide/tabular mode when --no-header is active", () => {
    setSuppressHeaders(true);
    process.env.COLUMNS = "120";

    const { stderr } = captureOutput(() =>
      printTable(["Asset", "Balance"], [["ETH", "1.00"]]),
    );

    expect(stderr).toContain("ETH");
    expect(stderr).not.toContain("Asset");
    expect(stderr).not.toContain("Balance");
  });

  test("keeps stacked labels in narrow mode even when headers are suppressed", () => {
    setSuppressHeaders(true);
    process.env.COLUMNS = "40";

    const { stderr } = captureOutput(() =>
      printTable(["Asset", "Balance"], [["ETH", "1.00"]]),
    );

    expect(stderr).toContain("Asset");
    expect(stderr).toContain("Balance");
  });
});

// ── Pools CSV ────────────────────────────────────────────────────────────────

describe("pools CSV", () => {
  const STUB_POOL = {
    symbol: "ETH",
    asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`,
    pool: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    scope: 42n,
    decimals: 18,
    minimumDepositAmount: 100000000000000n,
    vettingFeeBPS: 50n,
    maxRelayFeeBPS: 100n,
  };

  test("renderPoolsEmpty: CSV outputs header row only", () => {
    const ctx = createOutputContext(csvMode());
    const data: PoolsRenderData = {
      allChains: false,
      chainName: "sepolia",
      search: null,
      sort: "default",
      filteredPools: [],
      warnings: [],
    };
    const { stdout, stderr } = captureOutput(() => renderPoolsEmpty(ctx, data));
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(1); // header only
    expect(lines[0]).toContain("Asset");
    expect(stderr).toBe("");
  });

  test("renderPools: CSV includes data rows", () => {
    const ctx = createOutputContext(csvMode());
    const data: PoolsRenderData = {
      allChains: false,
      chainName: "sepolia",
      search: null,
      sort: "default",
      filteredPools: [{ chain: "sepolia", chainId: 11155111, pool: STUB_POOL }],
      warnings: [],
    };
    const { stdout, stderr } = captureOutput(() => renderPools(ctx, data));
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[1]).toContain("ETH");
    expect(stderr).toBe("");
  });

  test("renderPools: allChains CSV includes Chain column", () => {
    const ctx = createOutputContext(csvMode());
    const data: PoolsRenderData = {
      allChains: true,
      chainName: "mainnet",
      search: null,
      sort: "default",
      filteredPools: [{ chain: "sepolia", chainId: 11155111, pool: STUB_POOL }],
      chainSummaries: [],
      warnings: [],
    };
    const { stdout } = captureOutput(() => renderPools(ctx, data));
    const header = stdout.split("\n")[0];
    expect(header).toMatch(/^Chain,/);
  });
});

// ── Accounts CSV ─────────────────────────────────────────────────────────────

describe("accounts CSV", () => {
  const STUB_COMMITMENT = {
    hash: 123n,
    label: 456n,
    value: 1000000000000000000n,
    blockNumber: 100n,
    txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  };

  const STUB_GROUP: AccountPoolGroup = {
    symbol: "ETH",
    poolAddress: "0x1111111111111111111111111111111111111111",
    decimals: 18,
    scope: 42n,
    tokenPrice: null,
    poolAccounts: [
      {
        paNumber: 1,
        paId: "PA-1",
        status: "approved",
        aspStatus: "approved",
        commitment: STUB_COMMITMENT,
        label: 456n,
        value: 1000000000000000000n,
        blockNumber: 100n,
        txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
      },
    ],
  };

  test("renderAccountsNoPools: CSV outputs header only", () => {
    const ctx = createOutputContext(csvMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccountsNoPools(ctx, {
        chain: "sepolia",
        emptyReason: "first_deposit",
      }),
    );
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("PA");
    expect(stderr).toBe("");
  });

  test("renderAccountsNoPools: CSV summary renders the zero-count summary row", () => {
    const ctx = createOutputContext(csvMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccountsNoPools(ctx, {
        chain: "all-mainnets",
        allChains: true,
        chains: ["mainnet", "arbitrum"],
        summary: true,
      }),
    );
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toContain("Chain,Asset,Balance,USD,Pool Accounts,Pending,Approved");
    expect(lines[1]).toContain(",0,0,0,0,0,0,0");
    expect(stderr).toBe("");
  });

  test("renderAccounts: CSV includes account rows", () => {
    const ctx = createOutputContext(csvMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        groups: [STUB_GROUP],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[0]).toBe("PA,Status,ASP,Asset,Value,Tx,Last Sync (ISO)");
    expect(lines[0]).not.toContain("Block");
    expect(lines[1]).toContain("PA-1");
    expect(lines[1]).toContain("approved");
    expect(lines[1].split(",")).toHaveLength(7);
    expect(stderr).toBe("");
  });
});

// ── History CSV ──────────────────────────────────────────────────────────────

describe("history CSV", () => {
  const STUB_EVENTS = [
    {
      type: "deposit" as const,
      asset: "ETH",
      poolAddress: "0x1111111111111111111111111111111111111111",
      paNumber: 1,
      paId: "PA-1",
      value: 1000000000000000000n,
      blockNumber: 200n,
      txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
    },
  ];

  const STUB_POOL_MAP = new Map([
    ["0x1111111111111111111111111111111111111111", { pool: "0x1111111111111111111111111111111111111111", decimals: 18 }],
  ]);

  const mockExplorerUrl = (_chainId: number, _txHash: string) => null;

  test("renderHistoryNoPools: CSV outputs header only", () => {
    const ctx = createOutputContext(csvMode());
    const { stdout, stderr } = captureOutput(() =>
      renderHistoryNoPools(ctx, { chain: "sepolia" }),
    );
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("Type,PA,Amount,Tx,Time,Block");
    expect(stderr).toBe("");
  });

  test("renderHistory: CSV includes event rows", () => {
    const ctx = createOutputContext(csvMode());
    const { stdout, stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: STUB_EVENTS,
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
        currentBlock: 250n,
      }),
    );
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Deposit");
    expect(lines[1]).toContain("PA-1");
    expect(lines[1].split(",")).toHaveLength(6);
    expect(stderr).toBe("");
  });
});

// ── Activity CSV ─────────────────────────────────────────────────────────────

describe("activity CSV", () => {
  const STUB_DATA: ActivityRenderData = {
    mode: "global-activity",
    chain: "sepolia",
    page: 1,
    perPage: 10,
    total: 1,
    totalPages: 1,
    events: [
      {
        type: "deposit",
        txHash: "0xaabb",
        reviewStatus: "approved",
        amountRaw: "1000000000000000000",
        amountFormatted: "1.0 ETH",
        timestampMs: 1700000000000,
        timeLabel: "2023-11-14",
        poolSymbol: "ETH",
        poolAddress: "0x1111",
        chainId: 11155111,
      },
    ],
  };

  test("renderActivity: CSV outputs events", () => {
    const ctx = createOutputContext(csvMode());
    const { stdout, stderr } = captureOutput(() => renderActivity(ctx, STUB_DATA));
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Type");
    expect(lines[1]).toContain("Deposit");
    expect(stderr).toBe("");
  });
});

// ── Stats CSV ────────────────────────────────────────────────────────────────

describe("stats CSV", () => {
  const STUB_TIME_STATS = {
    tvlUsd: "1000000",
    avgDepositSizeUsd: "500",
    totalDepositsCount: 100,
    totalWithdrawalsCount: 50,
  };

  test("renderGlobalStats: CSV outputs stats rows", () => {
    const ctx = createOutputContext(csvMode());
    const data: GlobalStatsRenderData = {
      mode: "global-stats",
      chain: "sepolia",
      cacheTimestamp: null,
      allTime: STUB_TIME_STATS,
      last24h: null,
    };
    const { stdout, stderr } = captureOutput(() => renderGlobalStats(ctx, data));
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(5); // header + 4 metric rows
    expect(lines[0]).toContain("Metric");
    expect(lines[1]).toContain("Current TVL");
    expect(stderr).toBe("");
  });

  test("renderGlobalStats: perChain CSV includes Chain column", () => {
    const ctx = createOutputContext(csvMode());
    const data: GlobalStatsRenderData = {
      mode: "global-stats",
      chain: "all",
      chains: ["sepolia", "mainnet"],
      cacheTimestamp: null,
      allTime: null,
      last24h: null,
      perChain: [
        { chain: "sepolia", cacheTimestamp: null, allTime: STUB_TIME_STATS, last24h: null },
        { chain: "mainnet", cacheTimestamp: null, allTime: null, last24h: null },
      ],
    };
    const { stdout } = captureOutput(() => renderGlobalStats(ctx, data));
    const header = stdout.split("\n")[0];
    expect(header).toMatch(/^Chain,/);
  });

  test("renderPoolStats: CSV outputs stats rows", () => {
    const ctx = createOutputContext(csvMode());
    const data: PoolStatsRenderData = {
      mode: "pool-stats",
      chain: "sepolia",
      asset: "ETH",
      pool: "0x1111",
      scope: "42",
      cacheTimestamp: null,
      allTime: STUB_TIME_STATS,
      last24h: null,
    };
    const { stdout, stderr } = captureOutput(() => renderPoolStats(ctx, data));
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(5);
    expect(stderr).toBe("");
  });
});
