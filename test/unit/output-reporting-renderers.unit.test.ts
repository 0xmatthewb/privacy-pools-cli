/**
 * Unit tests for reporting output renderers: pools, balance, accounts, history.
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { renderPoolsEmpty, renderPools, poolToJson, type PoolsRenderData } from "../../src/output/pools.ts";
import { renderAccountsNoPools, renderAccounts, type AccountPoolGroup } from "../../src/output/accounts.ts";
import { renderHistoryNoPools, renderHistory } from "../../src/output/history.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

// ── Stub data ────────────────────────────────────────────────────────────────

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

const STUB_POOLS_DATA: PoolsRenderData = {
  allChains: false,
  chainName: "sepolia",
  search: null,
  sort: "default",
  filteredPools: [{ chain: "sepolia", chainId: 11155111, pool: STUB_POOL }],
  warnings: [],
};

// ── renderPoolsEmpty parity ─────────────────────────────────────────────────

describe("renderPoolsEmpty parity", () => {
  test("JSON mode: emits empty pools envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolsRenderData = {
      allChains: false,
      chainName: "sepolia",
      search: null,
      sort: "default",
      filteredPools: [],
      warnings: [],
    };
    const { stdout, stderr } = captureOutput(() => renderPoolsEmpty(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.pools).toEqual([]);
    expect(stderr).toBe("");
  });

  test("JSON mode: uses allChains key for multi-chain", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolsRenderData = {
      allChains: true,
      chainName: "mainnet",
      search: null,
      sort: "default",
      filteredPools: [],
      warnings: [],
    };
    const { stdout } = captureOutput(() => renderPoolsEmpty(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.allChains).toBe(true);
    expect(json.chain).toBeUndefined();
  });

  test("human mode: emits no-pools message to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolsRenderData = {
      allChains: false,
      chainName: "sepolia",
      search: null,
      sort: "default",
      filteredPools: [],
      warnings: [],
    };
    const { stdout, stderr } = captureOutput(() => renderPoolsEmpty(ctx, data));

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderPools parity ──────────────────────────────────────────────────────

describe("renderPools parity", () => {
  test("JSON mode: emits pools envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderPools(ctx, STUB_POOLS_DATA));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.pools.length).toBe(1);
    expect(json.pools[0].symbol).toBe("ETH");
    expect(stderr).toBe("");
  });

  test("human mode: emits table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderPools(ctx, STUB_POOLS_DATA));

    expect(stdout).toBe("");
    expect(stderr).toContain("Pools on sepolia");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("Vetting Fee");
  });

  test("human mode: shows search-empty message when no matches", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolsRenderData = {
      ...STUB_POOLS_DATA,
      search: "nonexistent",
      filteredPools: [],
    };
    const { stderr } = captureOutput(() => renderPools(ctx, data));

    expect(stderr).toContain('No pools matched search query "nonexistent"');
  });

  test("human mode: includes USD Value column header", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderPools(ctx, STUB_POOLS_DATA));

    expect(stderr).toContain("USD Value");
  });

  test("human mode: shows USD amount when pool has USD data", () => {
    const ctx = createOutputContext(makeMode());
    const poolWithUsd = {
      ...STUB_POOL,
      acceptedDepositsValue: 10000000000000000000n,
      acceptedDepositsValueUsd: "20000",
    };
    const data: PoolsRenderData = {
      ...STUB_POOLS_DATA,
      filteredPools: [{ chain: "sepolia", chainId: 11155111, pool: poolWithUsd }],
    };
    const { stderr } = captureOutput(() => renderPools(ctx, data));

    expect(stderr).toContain("$20,000");
  });
});

// ── poolToJson parity ───────────────────────────────────────────────────────

describe("poolToJson", () => {
  test("serializes pool stats to JSON-friendly record", () => {
    const json = poolToJson(STUB_POOL);
    expect(json.symbol).toBe("ETH");
    expect(json.scope).toBe("42");
    expect(json.minimumDeposit).toBe("100000000000000");
    expect(json.chain).toBeUndefined();
  });

  test("includes chain when provided", () => {
    const json = poolToJson(STUB_POOL, "sepolia");
    expect(json.chain).toBe("sepolia");
  });
});

// ── renderAccountsNoPools parity ────────────────────────────────────────────

describe("renderAccountsNoPools parity", () => {
  test("JSON mode: emits empty accounts envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderAccountsNoPools(ctx, "sepolia"));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.accounts).toEqual([]);
    expect(stderr).toBe("");
  });

  test("human mode: emits no-pools message", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderAccountsNoPools(ctx, "sepolia"));

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderAccounts parity ───────────────────────────────────────────────────

describe("renderAccounts parity", () => {
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
        status: "spendable",
        aspStatus: "approved",
        commitment: STUB_COMMITMENT,
        label: 456n,
        value: 1000000000000000000n,
        blockNumber: 100n,
        txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
      },
    ],
  };

  const STUB_GROUP_WITH_USD: AccountPoolGroup = {
    ...STUB_GROUP,
    tokenPrice: 2000,
  };

  test("JSON mode: emits accounts envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showAll: false,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.accounts.length).toBe(1);
    expect(json.accounts[0].poolAccountId).toBe("PA-1");
    expect(json.accounts[0].aspStatus).toBe("approved");
    expect(stderr).toBe("");
  });

  test("human mode (summary): emits summary table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showAll: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Pool Accounts (PA) on sepolia");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Approved");
  });

  test("human mode (detail): emits detail table with commitment columns", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: true,
        showAll: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Commitment");
    expect(stderr).toContain("Label");
    expect(stderr).toContain("Block");
  });

  test("human mode: shows empty-state message when no groups have accounts", () => {
    const ctx = createOutputContext(makeMode());
    const emptyGroup: AccountPoolGroup = { ...STUB_GROUP, poolAccounts: [] };
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [emptyGroup],
        showDetails: false,
        showAll: false,
      }),
    );

    expect(stderr).toContain("No available Pool Accounts found");
  });

  test("human mode (summary): shows USD column when tokenPrice is set", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP_WITH_USD],
        showDetails: false,
        showAll: false,
      }),
    );

    expect(stderr).toContain("USD");
    expect(stderr).toContain("$2,000");
  });

  test("human mode (summary): hides USD column when tokenPrice is null", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showAll: false,
      }),
    );

    expect(stderr).not.toContain("USD");
  });

  test("human mode (detail): shows USD column when tokenPrice is set", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP_WITH_USD],
        showDetails: true,
        showAll: false,
      }),
    );

    expect(stderr).toContain("USD");
    expect(stderr).toContain("$2,000");
  });
});

// ── renderHistoryNoPools parity ─────────────────────────────────────────────

describe("renderHistoryNoPools parity", () => {
  test("JSON mode: emits empty events envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderHistoryNoPools(ctx, "sepolia"));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.events).toEqual([]);
    expect(stderr).toBe("");
  });

  test("human mode: emits no-pools message", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderHistoryNoPools(ctx, "sepolia"));

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderHistory parity ────────────────────────────────────────────────────

describe("renderHistory parity", () => {
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
    {
      type: "withdrawal" as const,
      asset: "ETH",
      poolAddress: "0x1111111111111111111111111111111111111111",
      paNumber: 1,
      paId: "PA-1",
      value: 500000000000000000n,
      blockNumber: 100n,
      txHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
    },
  ];

  const STUB_POOL_MAP = new Map([
    ["0x1111111111111111111111111111111111111111", { pool: "0x1111111111111111111111111111111111111111", decimals: 18 }],
  ]);

  const mockExplorerUrl = (chainId: number, txHash: string) =>
    `https://sepolia.etherscan.io/tx/${txHash}`;

  test("JSON mode: emits events envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: STUB_EVENTS,
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.events.length).toBe(2);
    expect(json.events[0].type).toBe("deposit");
    expect(json.events[0].explorerUrl).toContain("etherscan.io");
    expect(json.events[1].type).toBe("withdrawal");
    expect(stderr).toBe("");
  });

  test("human mode: emits history table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: STUB_EVENTS,
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("History on sepolia");
    expect(stderr).toContain("Deposit");
    expect(stderr).toContain("Withdraw");
    expect(stderr).toContain("PA-1");
  });

  test("human mode: shows empty-state for no events", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: [],
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
      }),
    );

    expect(stderr).toContain("No events found on sepolia");
  });
});
