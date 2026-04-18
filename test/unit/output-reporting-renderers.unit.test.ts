/**
 * Unit tests for reporting output renderers: pools, accounts, history, pool detail.
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { renderPoolsEmpty, renderPools, renderPoolDetail, poolToJson, type PoolsRenderData, type PoolDetailRenderData, type PoolDetailActivityEvent } from "../../src/output/pools.ts";
import { renderAccountsNoPools, renderAccounts, type AccountPoolGroup } from "../../src/output/accounts.ts";
import { renderHistoryNoPools, renderHistory } from "../../src/output/history.ts";
import {
  renderChangelog,
  renderUpgradeResult,
  type UpgradeResult,
} from "../../src/output/upgrade.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";
import { makeMode, captureOutput, parseCapturedJson } from "../helpers/output.ts";

function expectNextAction(
  action: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
  cliCommand: string,
): void {
  const { options, ...rest } = expected;
  const normalizedOptions =
    options && typeof options === "object"
      ? Object.fromEntries(
          Object.entries(options as Record<string, unknown>).filter(
            ([key]) => key !== "agent",
          ),
        )
      : undefined;
  expect(action).toMatchObject({
    ...rest,
    ...(normalizedOptions && Object.keys(normalizedOptions).length > 0
      ? { options: normalizedOptions }
      : {}),
  });
  expect((action?.options as Record<string, unknown> | undefined)?.agent).toBeUndefined();
  expect(action?.cliCommand).toBe(cliCommand);
}

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

    const json = parseCapturedJson(stdout);
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

    const json = parseCapturedJson(stdout);
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

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
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
    expect(stderr).toBe("");
  });
});

// ── renderPools parity ──────────────────────────────────────────────────────

describe("renderPools parity", () => {
  test("JSON mode: emits pools envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderPools(ctx, STUB_POOLS_DATA));

    const json = parseCapturedJson(stdout);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.pools.length).toBe(1);
    expect(json.pools[0].asset).toBe("ETH");
    expect(json.pools[0].tokenAddress).toBe("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    expect(json.nextActions).toBeDefined();
    expect(json.nextActions.length).toBe(1);
    expect(json.nextActions[0].command).toBe("deposit");
    expect(json.nextActions[0].runnable).toBe(false);
    // Single-chain query must carry chain context to prevent wrong-network deposits
    expect(json.nextActions[0].options?.chain).toBe("sepolia");
    expect(json.nextActions[0].cliCommand).toBeUndefined();
    expect(json.nextActions[0].parameters).toEqual([
      { name: "amount", type: "token_amount", required: true },
      { name: "asset", type: "asset_symbol", required: true },
    ]);
    expect(stderr).toBe("");
  });

  test("JSON mode: orders owned-pool nextActions before deposit templates", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolsRenderData = {
      ...STUB_POOLS_DATA,
      filteredPools: [
        {
          ...STUB_POOLS_DATA.filteredPools[0]!,
          myPoolAccountsCount: 2,
        },
      ],
    };
    const { stdout } = captureOutput(() => renderPools(ctx, data));

    const json = parseCapturedJson(stdout);
    expect(json.nextActions.map((action: { command: string }) => action.command)).toEqual([
      "accounts",
      "pools",
      "deposit",
    ]);
    expect(json.nextActions[0].cliCommand).toBe(
      "privacy-pools accounts --agent --chain sepolia",
    );
    expect(json.nextActions[1].cliCommand).toBe(
      "privacy-pools pools ETH --agent --chain sepolia",
    );
    expect(json.nextActions[2].runnable).toBe(false);
  });

  test("JSON mode: all-chains query omits chain from deposit nextAction", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolsRenderData = {
      ...STUB_POOLS_DATA,
      allChains: true,
      chainName: "mainnet",
      chainSummaries: [{ chain: "mainnet", pools: 1, error: null }],
    };
    const { stdout } = captureOutput(() => renderPools(ctx, data));

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toBeDefined();
    expect(json.nextActions[0].command).toBe("deposit");
    // All-chains query must NOT include chain — agent picks the target chain
    expect(json.nextActions[0].options?.chain).toBeUndefined();
    expect(json.nextActions[0].cliCommand).toBeUndefined();
    expect(json.nextActions[0].parameters).toEqual([
      { name: "amount", type: "token_amount", required: true },
      { name: "asset", type: "asset_symbol", required: true },
    ]);
  });

  test("JSON mode: all-chains query preserves chain summaries, warnings, and pool account counts", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolsRenderData = {
      ...STUB_POOLS_DATA,
      allChains: true,
      chainName: "mainnet",
      chainSummaries: [
        { chain: "mainnet", pools: 1, error: null },
        { chain: "arbitrum", pools: 0, error: "rpc unavailable" },
      ],
      warnings: [
        {
          chain: "arbitrum",
          category: "RPC",
          message: "rpc unavailable",
        },
      ],
      filteredPools: [
        {
          chain: "mainnet",
          chainId: 1,
          pool: STUB_POOL,
          myPoolAccountsCount: 2,
        },
      ],
    };

    const { stdout } = captureOutput(() => renderPools(ctx, data));
    const json = parseCapturedJson(stdout);

    expect(json.chains).toEqual(data.chainSummaries);
    expect(json.warnings).toEqual(data.warnings);
    expect(json.pools[0].chain).toBe("mainnet");
    expect(json.pools[0].myPoolAccountsCount).toBe(2);
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

  test("human mode: surfaces degraded-chain warnings and your pool-account counts", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolsRenderData = {
      ...STUB_POOLS_DATA,
      warnings: [
        {
          chain: "sepolia",
          category: "RPC",
          message: "using cached pool metadata",
        },
      ],
      filteredPools: [
        {
          chain: "sepolia",
          chainId: 11155111,
          pool: STUB_POOL,
          myPoolAccountsCount: 3,
        },
      ],
    };

    const { stderr } = captureOutput(() => renderPools(ctx, data));

    expect(stderr).toContain("sepolia (RPC): using cached pool metadata");
    expect(stderr).toContain("Your PAs");
    expect(stderr).toContain("3");
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

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderPools(ctx, STUB_POOLS_DATA));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── poolToJson parity ───────────────────────────────────────────────────────

describe("poolToJson", () => {
  test("serializes pool stats to JSON-friendly record", () => {
    const json = poolToJson(STUB_POOL);
    expect(json.asset).toBe("ETH");
    expect(json.tokenAddress).toBe("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
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
    const { stdout, stderr } = captureOutput(() => renderAccountsNoPools(ctx, { chain: "sepolia" }));

    const json = parseCapturedJson(stdout);
    expect(json.success).toBe(true);
    expect(json.accounts).toEqual([]);
    expect(json.nextActions).toEqual([
      expect.objectContaining({
        command: "pools",
        when: "accounts_empty",
        options: { chain: "sepolia" },
      }),
    ]);
    expect(stderr).toBe("");
  });

  test("JSON mode with --summary shape: emits zero-count summary envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderAccountsNoPools(ctx, { chain: "sepolia", summary: true }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.pendingCount).toBe(0);
    expect(json.approvedCount).toBe(0);
    expect(json.poaRequiredCount).toBe(0);
    expect(json.declinedCount).toBe(0);
    expect(json.balances).toEqual([]);
    expect(json.accounts).toBeUndefined();
    expect(json.nextActions).toEqual([
      expect.objectContaining({
        command: "pools",
        when: "accounts_summary_empty",
        options: { chain: "sepolia" },
      }),
    ]);
  });

  test("human mode: emits history-specific empty message", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccountsNoPools(ctx, {
        chain: "sepolia",
        emptyReason: "first_deposit",
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("No Pool Accounts found on sepolia.");
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools pools --chain sepolia");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderAccountsNoPools(ctx, { chain: "sepolia" }));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
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
    chain: "sepolia",
    chainId: 11155111,
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

  const STUB_GROUP_WITH_USD: AccountPoolGroup = {
    ...STUB_GROUP,
    tokenPrice: 2000,
  };

  const STUB_PENDING_GROUP: AccountPoolGroup = {
    ...STUB_GROUP,
    poolAccounts: [
      {
        ...STUB_GROUP.poolAccounts[0]!,
        status: "pending",
        aspStatus: "pending",
      },
    ],
  };

  const STUB_DECLINED_GROUP: AccountPoolGroup = {
    ...STUB_GROUP,
    poolAccounts: [
      {
        ...STUB_GROUP.poolAccounts[0]!,
        status: "declined",
        aspStatus: "declined",
      },
    ],
  };

  const STUB_POI_REQUIRED_GROUP: AccountPoolGroup = {
    ...STUB_GROUP,
    poolAccounts: [
      {
        ...STUB_GROUP.poolAccounts[0]!,
        status: "poa_required",
        aspStatus: "poa_required",
      },
    ],
  };

  test("JSON mode: emits accounts envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.accounts.length).toBe(1);
    expect(json.accounts[0].poolAccountId).toBe("PA-1");
    expect(json.accounts[0].aspStatus).toBe("approved");
    expect(typeof json.accounts[0].explorerUrl).toBe("string");
    expect(json.accounts[0].explorerUrl).toContain("etherscan.io");
    expect(json.nextActions).toBeUndefined();
    expect(stderr).toBe("");
  });

  test("human mode (summary): emits summary table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Pool Accounts on sepolia");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Approved");
    expect(stderr).toContain("ETH Pool:");
    expect(stderr).not.toContain(STUB_GROUP.poolAddress);
    expect(stderr).not.toContain("Tx");
    expect(stderr).toContain("--details for tx hashes");
  });

  test("JSON mode with --summary: emits counts and balances without accounts", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_PENDING_GROUP],
        showDetails: false,
        showSummary: true,
        showPendingOnly: false,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.accounts).toBeUndefined();
    expect(json.pendingCount).toBe(1);
    expect(json.approvedCount).toBe(0);
    expect(json.poaRequiredCount).toBe(0);
    expect(json.declinedCount).toBe(0);
    expect(json.unknownCount).toBe(0);
    expect(json.balances).toEqual([
      {
        asset: "ETH",
        balance: "1000000000000000000",
        usdValue: null,
        poolAccounts: 1,
      },
    ]);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        reason: "Poll again until pending deposits leave ASP review, then confirm whether they were approved, declined, or need Proof of Association.",
        when: "has_pending",
        options: { agent: true, chain: "sepolia", pendingOnly: true },
      },
      "privacy-pools accounts --agent --chain sepolia --pending-only",
    );
  });

  test("JSON mode with --pending-only: filters accounts and omits balances", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP, STUB_PENDING_GROUP],
        showDetails: false,
        showSummary: false,
        showPendingOnly: true,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.pendingCount).toBe(1);
    expect(json.accounts).toHaveLength(1);
    expect(json.accounts[0].aspStatus).toBe("pending");
    expect(json.balances).toBeUndefined();
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        reason: "Poll again until pending deposits leave ASP review, then confirm whether they were approved, declined, or need Proof of Association.",
        when: "has_pending",
        options: { agent: true, chain: "sepolia", pendingOnly: true },
      },
      "privacy-pools accounts --agent --chain sepolia --pending-only",
    );
  });

  test("human mode: surfaces POA Needed account status and remediation guidance", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_POI_REQUIRED_GROUP],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stderr).toContain("POA Needed");
    expect(stderr).toContain(POA_PORTAL_URL);
  });

  test("human mode (detail): hides troubleshooting columns by default", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: true,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).not.toContain("Commitment");
    expect(stderr).not.toContain("Label");
    expect(stderr).not.toContain("Block");
    expect(stderr).toContain("--verbose for troubleshooting metadata");
  });

  test("human mode (detail + verbose): shows troubleshooting columns", () => {
    const ctx = createOutputContext(makeMode(), true);
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: true,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stderr).toContain("Commitment");
    expect(stderr).toContain("Label");
    expect(stderr).toContain("Block");
  });

  test("human mode: surfaces declined account status and exit-only guidance", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_DECLINED_GROUP],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stderr).toContain("Declined");
    expect(stderr).toContain("cannot use withdraw");
  });

  test("human mode: shows empty-state message when no groups have accounts", () => {
    const ctx = createOutputContext(makeMode());
    const emptyGroup: AccountPoolGroup = { ...STUB_GROUP, poolAccounts: [] };
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [emptyGroup],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    // Group exists with empty poolAccounts but no hidden history either.
    expect(stderr).toContain("No Pool Accounts found");
  });

  test("human mode (summary): shows USD column when tokenPrice is set", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP_WITH_USD],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
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
        showSummary: false,
        showPendingOnly: false,
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
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stderr).toContain("USD");
    expect(stderr).toContain("$2,000");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderHistoryNoPools parity ─────────────────────────────────────────────

describe("renderHistoryNoPools parity", () => {
  test("JSON mode: emits empty events envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderHistoryNoPools(ctx, "sepolia"));

    const json = parseCapturedJson(stdout);
    expect(json.success).toBe(true);
    expect(json.events).toEqual([]);
    expect(stderr).toBe("");
  });

  test("human mode: emits no-pools message", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderHistoryNoPools(ctx, "sepolia"));

    expect(stdout).toBe("");
    expect(stderr).toContain("No history events found on sepolia.");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderHistoryNoPools(ctx, "sepolia"));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
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

    const json = parseCapturedJson(stdout);
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
        currentBlock: 300n,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("History on sepolia");
    expect(stderr).toContain("Deposit");
    expect(stderr).toContain("Withdraw");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Time");
  });

  test("human mode: shows '-' for time when current block is unavailable", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: [STUB_EVENTS[0]!],
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
        currentBlock: null,
      }),
    );

    expect(stderr).toContain("Time");
    expect(stderr).toMatch(/0xaabbccdd\.\.\.7890aabb\s+-\s/);
  });

  test("human mode: labels migration events distinctly", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: [
          {
            ...STUB_EVENTS[0]!,
            type: "migration",
          },
        ],
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
        currentBlock: 300n,
      }),
    );

    expect(stderr).toContain("Migration");
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
        currentBlock: 300n,
      }),
    );

    expect(stderr).toContain("No history events found on sepolia.");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: STUB_EVENTS,
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
        currentBlock: 300n,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderPoolDetail parity ─────────────────────────────────────────────────

const STUB_POOL_DETAIL_POOL = {
  ...STUB_POOL,
  totalDepositsValue: 10000000000000000000n,
  totalDepositsValueUsd: "20000",
  acceptedDepositsValue: 8000000000000000000n,
  acceptedDepositsValueUsd: "16000",
  pendingDepositsValue: 2000000000000000000n,
  pendingDepositsValueUsd: "4000",
  totalDepositsCount: 42,
  acceptedDepositsCount: 40,
  pendingDepositsCount: 2,
  growth24h: 5.2,
  pendingGrowth24h: 1.1,
  totalInPoolValue: 8000000000000000000n,
  totalInPoolValueUsd: "16000",
};

const STUB_POOL_ACCOUNT_REF = {
  paNumber: 1,
  paId: "PA-1",
  status: "approved" as const,
  aspStatus: "approved" as const,
  commitment: {
    hash: 123n,
    label: 456n,
    value: 1000000000000000000n,
    blockNumber: 100n,
    txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  },
  label: 456n,
  value: 1000000000000000000n,
  blockNumber: 100n,
  txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
};

const STUB_DECLINED_POOL_ACCOUNT_REF = {
  ...STUB_POOL_ACCOUNT_REF,
  paId: "PA-2",
  status: "declined" as const,
  aspStatus: "declined" as const,
};

const STUB_POA_POOL_ACCOUNT_REF = {
  ...STUB_POOL_ACCOUNT_REF,
  paId: "PA-3",
  status: "poa_required" as const,
  aspStatus: "poa_required" as const,
};

const STUB_ACTIVITY: PoolDetailActivityEvent[] = [
  { type: "deposit", amount: "1.0 ETH", timeLabel: "2h ago", status: "Approved" },
  { type: "withdrawal", amount: "0.5 ETH", timeLabel: "1d ago", status: null },
];

const STUB_NORMALIZED_ACTIVITY: PoolDetailActivityEvent[] = [
  { type: "deposit", amount: "1.0 ETH", timeLabel: "2h ago", status: "approved" },
  { type: "withdrawal", amount: "0.5 ETH", timeLabel: "1d ago", status: "approved" },
];

const STUB_POOL_DETAIL_DATA: PoolDetailRenderData = {
  chain: "sepolia",
  pool: STUB_POOL_DETAIL_POOL,
  tokenPrice: 2000,
  walletState: "available",
  myPoolAccounts: [STUB_POOL_ACCOUNT_REF],
  recentActivity: STUB_ACTIVITY,
};

describe("renderPoolDetail parity", () => {
  test("JSON mode: emits pool detail envelope with myFunds and recentActivity", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderPoolDetail(ctx, STUB_POOL_DETAIL_DATA));

    const json = parseCapturedJson(stdout);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.nextActions).toBeDefined();
    expect(json.nextActions.map((action: { command: string }) => action.command)).toEqual([
      "withdraw",
      "ragequit",
      "accounts",
      "deposit",
    ]);
    expect(json.nextActions[0]).toMatchObject({
      command: "withdraw",
      runnable: false,
      args: ["ETH"],
      options: {
        chain: "sepolia",
        poolAccount: "PA-1",
        all: true,
      },
      parameters: [{ name: "to", type: "address", required: true }],
      reason: "Withdraw privately from PA-1 once you provide the recipient address.",
      when: "after_pool_detail",
    });
    expect(json.nextActions[1]).toMatchObject({
      command: "ragequit",
      options: {
        chain: "sepolia",
        poolAccount: "PA-1",
      },
    });

    // myFunds shape
    expect(json.myFunds).toBeDefined();
    expect(json.myFunds.balance).toBe("1000000000000000000");
    expect(json.myFunds.poolAccounts).toBe(1);
    expect(json.myFunds.pendingCount).toBe(0);
    expect(json.myFunds.accounts.length).toBe(1);
    expect(json.myFunds.accounts[0].id).toBe("PA-1");
    expect(json.myFunds.accounts[0].status).toBe("approved");
    expect(json.myFunds.accounts[0].aspStatus).toBe("approved");

    // recentActivity
    expect(json.recentActivity).toEqual(STUB_NORMALIZED_ACTIVITY);

    expect(stderr).toBe("");
  });

  test("JSON mode: myFunds is null when myPoolAccounts is null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolDetailRenderData = {
      ...STUB_POOL_DETAIL_DATA,
      walletState: "setup_required",
      myPoolAccounts: null,
    };
    const { stdout } = captureOutput(() => renderPoolDetail(ctx, data));

    const json = parseCapturedJson(stdout);
    expect(json.myFunds).toBeNull();
    expect(json.nextActions.map((action: { command: string }) => action.command)).toEqual([
      "accounts",
      "deposit",
    ]);
    expect(json.nextActions[1].runnable).toBe(false);
  });

  test("JSON mode: orders required public recovery before optional alternatives", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderPoolDetail(ctx, {
        ...STUB_POOL_DETAIL_DATA,
        myPoolAccounts: [
          STUB_POOL_ACCOUNT_REF,
          STUB_DECLINED_POOL_ACCOUNT_REF,
          STUB_POA_POOL_ACCOUNT_REF,
        ],
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions.map((action: { command: string }) => action.command)).toEqual([
      "withdraw",
      "ragequit",
      "ragequit",
      "ragequit",
      "accounts",
      "deposit",
    ]);
    expect(json.nextActions.map((action: { options?: { poolAccount?: string } }) =>
      action.options?.poolAccount ?? null,
    )).toEqual(["PA-1", "PA-2", "PA-1", "PA-3", null, null]);
    expect(json.nextActions.at(-1)?.runnable).toBe(false);
  });

  test("JSON mode: normalizes migration recentActivity status as approved", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderPoolDetail(ctx, {
        ...STUB_POOL_DETAIL_DATA,
        recentActivity: [
          {
            type: "migration",
            amount: "0.75 ETH",
            timeLabel: "3h ago",
            status: "declined",
          },
        ],
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.recentActivity).toEqual([
      {
        type: "migration",
        amount: "0.75 ETH",
        timeLabel: "3h ago",
        status: "approved",
      },
    ]);
  });

  test("JSON mode: includes myFundsWarning when wallet state could not be loaded", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolDetailRenderData = {
      ...STUB_POOL_DETAIL_DATA,
      walletState: "load_failed",
      myPoolAccounts: null,
      myFundsWarning: "Could not load your wallet state right now: boom",
    };
    const { stdout } = captureOutput(() => renderPoolDetail(ctx, data));

    const json = parseCapturedJson(stdout);
    expect(json.myFunds).toBeNull();
    expect(json.myFundsWarning).toBe("Could not load your wallet state right now: boom");
  });

  test("JSON mode: includes myFundsWarning alongside myFunds when ASP review data is partial", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolDetailRenderData = {
      ...STUB_POOL_DETAIL_DATA,
      myFundsWarning: "Some ASP review data was unavailable or incomplete.",
    };
    const { stdout } = captureOutput(() => renderPoolDetail(ctx, data));

    const json = parseCapturedJson(stdout);
    expect(json.myFunds).toBeDefined();
    expect(json.myFundsWarning).toBe("Some ASP review data was unavailable or incomplete.");
  });

  test("JSON mode: flags recentActivityUnavailable explicitly", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderPoolDetail(ctx, {
        ...STUB_POOL_DETAIL_DATA,
        recentActivity: null,
        recentActivityUnavailable: true,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.recentActivity).toBeUndefined();
    expect(json.recentActivityUnavailable).toBe(true);
  });

  test("JSON mode: omits recentActivity when null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolDetailRenderData = { ...STUB_POOL_DETAIL_DATA, recentActivity: null };
    const { stdout } = captureOutput(() => renderPoolDetail(ctx, data));

    const json = parseCapturedJson(stdout);
    expect(json.recentActivity).toBeUndefined();
  });

  test("human mode: emits pool stats and my funds to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderPoolDetail(ctx, STUB_POOL_DETAIL_DATA));

    expect(stdout).toBe("");
    expect(stderr).toContain("ETH Pool on sepolia");
    expect(stderr).toContain("Pool Balance:");
    expect(stderr).toContain("Pending Funds:");
    expect(stderr).toContain("All-Time Deposits:");
    expect(stderr).toContain("Vetting Fee:");
    expect(stderr).toContain("Min Deposit:");
    expect(stderr).toContain("Your funds:");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Approved");
  });

  test("human mode: shows init prompt when myPoolAccounts is null", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolDetailRenderData = {
      ...STUB_POOL_DETAIL_DATA,
      walletState: "setup_required",
      myPoolAccounts: null,
    };
    const { stderr } = captureOutput(() => renderPoolDetail(ctx, data));

    expect(stderr).toContain("privacy-pools init");
  });

  test("human mode: shows wallet-state warning instead of init prompt when loading fails", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolDetailRenderData = {
      ...STUB_POOL_DETAIL_DATA,
      walletState: "load_failed",
      myPoolAccounts: null,
      myFundsWarning: "Could not load your wallet state right now: Stored recovery phrase is invalid or corrupted.",
    };
    const { stderr } = captureOutput(() => renderPoolDetail(ctx, data));

    expect(stderr).toContain("Could not load your wallet state right now");
    expect(stderr).not.toContain("privacy-pools init");
  });

  test("human mode: shows myFundsWarning alongside loaded funds when ASP review data is partial", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolDetailRenderData = {
      ...STUB_POOL_DETAIL_DATA,
      myFundsWarning: "Some ASP review data was unavailable or incomplete.",
    };
    const { stderr } = captureOutput(() => renderPoolDetail(ctx, data));

    expect(stderr).toContain("Your funds:");
    expect(stderr).toContain("Some ASP review data was unavailable or incomplete.");
    expect(stderr).not.toContain("privacy-pools init");
  });

  test("human mode: shows recent activity", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderPoolDetail(ctx, STUB_POOL_DETAIL_DATA));

    expect(stderr).toContain("Recent activity:");
    expect(stderr).toContain("Deposit");
    expect(stderr).toContain("1.0 ETH");
    expect(stderr).toContain("2h ago");
    expect(stderr).toContain("0.5 ETH");
    expect(stderr).toContain("Approved");
  });

  test("human mode: shows a degraded recent-activity warning when the feed is unavailable", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderPoolDetail(ctx, {
        ...STUB_POOL_DETAIL_DATA,
        recentActivity: null,
        recentActivityUnavailable: true,
      }),
    );

    expect(stderr).toContain("Recent public activity could not be loaded right now");
  });

  test("human mode: shows declined and PoA recovery callouts for affected balances", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderPoolDetail(ctx, {
        ...STUB_POOL_DETAIL_DATA,
        myPoolAccounts: [STUB_DECLINED_POOL_ACCOUNT_REF, STUB_POA_POOL_ACCOUNT_REF],
      }),
    );

    expect(stderr).toContain("Declined Pool Accounts cannot use withdraw");
    expect(stderr).toContain("Proof of Association is still required");
    expect(stderr).toContain(POA_PORTAL_URL);
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderPoolDetail(ctx, STUB_POOL_DETAIL_DATA));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("CSV mode: throws CLIError", () => {
    const ctx = createOutputContext(makeMode({ isCsv: true }));
    expect(() => renderPoolDetail(ctx, STUB_POOL_DETAIL_DATA)).toThrow(CLIError);
  });
});

// ── renderUpgradeResult nextActions parity ─────────────────────────────────

describe("renderUpgradeResult nextActions", () => {
  const baseResult: UpgradeResult = {
    status: "up_to_date",
    currentVersion: "2.1.0",
    latestVersion: "2.1.0",
    updateAvailable: false,
    performed: false,
    command: null,
    installContext: { kind: "global_npm", supportedAutoRun: true, reason: "Global npm install." },
    installedVersion: null,
  };

  test("JSON mode: 'ready' status emits runnable upgrade nextAction", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result: UpgradeResult = { ...baseResult, status: "ready", latestVersion: "2.2.0", updateAvailable: true, command: "npm i -g privacy-pools-cli@2.2.0" };
    const { stdout } = captureOutput(() => renderUpgradeResult(ctx, result));

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toBeDefined();
    expect(json.nextActions.length).toBe(1);
    expect(json.nextActions[0].command).toBe("upgrade");
    expect(json.nextActions[0].runnable).toBeUndefined(); // runnable (default true)
    expect(json.nextActions[0].options.yes).toBe(true);
  });

  test("JSON mode: 'manual' status emits no nextActions", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result: UpgradeResult = {
      ...baseResult,
      status: "manual",
      latestVersion: "2.2.0",
      updateAvailable: true,
      command: "npm i -g privacy-pools-cli@2.2.0",
      installContext: { kind: "source_checkout", supportedAutoRun: false, reason: "Source checkout." },
    };
    const { stdout } = captureOutput(() => renderUpgradeResult(ctx, result));

    const json = parseCapturedJson(stdout);
    // Manual status must NOT emit nextActions — the remediation is an external
    // install command in result.command, not a CLI command.
    expect(json.nextActions).toBeUndefined();
  });

  test("JSON mode: 'up_to_date' status emits no nextActions", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderUpgradeResult(ctx, baseResult));

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toBeUndefined();
  });

  test("human mode: 'ready' status renders highlights, manual fallback, and next steps", () => {
    const ctx = createOutputContext(makeMode());
    const result: UpgradeResult = {
      ...baseResult,
      status: "ready",
      latestVersion: "2.2.0",
      updateAvailable: true,
      command: "npm i -g privacy-pools-cli@2.2.0",
      releaseHighlights: ["Faster native shell", "Local proof verification"],
    };

    const { stderr } = captureOutput(() => renderUpgradeResult(ctx, result));

    expect(stderr).toContain("Update available: 2.1.0 -> 2.2.0");
    expect(stderr).toContain("Release highlights");
    expect(stderr).toContain("Faster native shell");
    expect(stderr).toContain("privacy-pools upgrade --yes");
    expect(stderr).toContain("npm i -g privacy-pools-cli@2.2.0");
    expect(stderr).toContain("Next steps:");
  });

  test("human mode: 'manual' status avoids CLI next steps and prints only manual guidance", () => {
    const ctx = createOutputContext(makeMode());
    const result: UpgradeResult = {
      ...baseResult,
      status: "manual",
      latestVersion: "2.1.0",
      updateAvailable: true,
      command: "npm i -g privacy-pools-cli@2.1.0",
      installContext: {
        kind: "source_checkout",
        supportedAutoRun: false,
        reason: "Source checkout detected.",
      },
      releaseHighlights: ["Manual release note"],
    };

    const { stderr } = captureOutput(() => renderUpgradeResult(ctx, result));

    expect(stderr).toContain("Automatic upgrade is not available from this install context.");
    expect(stderr).toContain("Source checkout detected.");
    expect(stderr).toContain("Manual command");
    expect(stderr).toContain("npm i -g privacy-pools-cli@2.1.0");
    expect(stderr).not.toContain("Next steps:");
  });

  test("human mode: 'cancelled' status explains that nothing changed", () => {
    const ctx = createOutputContext(makeMode());
    const result: UpgradeResult = {
      ...baseResult,
      status: "cancelled",
      latestVersion: "2.1.0",
      updateAvailable: true,
      command: "npm i -g privacy-pools-cli@2.1.0",
    };

    const { stderr } = captureOutput(() => renderUpgradeResult(ctx, result));

    expect(stderr).toContain("Upgrade cancelled. No changes were made.");
    expect(stderr).toContain("Install later");
    expect(stderr).toContain("npm i -g privacy-pools-cli@2.1.0");
  });
});

describe("renderChangelog", () => {
  test("JSON mode emits changelog availability explicitly", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderChangelog(ctx, "## 2.1.0\n- Faster"),
    );

    expect(parseCapturedJson(stdout)).toMatchObject({
      available: true,
      changelog: "## 2.1.0\n- Faster",
    });
  });

  test("human mode warns when the changelog is missing", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderChangelog(ctx, null));

    expect(stderr).toContain("CHANGELOG.md not found in the package root.");
  });

  test("human mode prints the changelog body and appends a trailing newline when needed", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout } = captureOutput(() =>
      renderChangelog(ctx, "## 2.1.0\n- Faster"),
    );

    expect(stdout).toBe("## 2.1.0\n- Faster\n");
  });

  test("CSV mode rejects changelog rendering", () => {
    const ctx = createOutputContext(makeMode({ isCsv: true }));
    expect(() => renderChangelog(ctx, "## 2.1.0")).toThrow(CLIError);
  });
});
