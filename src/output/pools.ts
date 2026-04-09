/**
 * Output renderer for the `pools` command.
 *
 * `src/commands/pools.ts` delegates final output here.
 * Pool fetching, search, sort, and spinner remain in the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import { guardCsvUnsupported, printJsonSuccess, printCsv, printTable, info, warn, isSilent, createNextAction, appendNextActions, renderNextSteps } from "./common.js";
import { POA_PORTAL_URL } from "../config/chains.js";
import { accentBold } from "../utils/theme.js";
import { formatAmount, formatBPS, displayDecimals, parseUsd, formatUsdValue } from "../utils/format.js";
import type { PoolStats } from "../types.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
import {
  isActivePoolAccountStatus,
  normalizePublicEventReviewStatus,
  renderAspApprovalStatus,
  renderPoolAccountStatus,
} from "../utils/statuses.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
  formatStackedKeyValueRows,
  getOutputWidthClass,
} from "./layout.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PoolWithChain {
  chain: string;
  chainId: number;
  pool: PoolStats;
}

export interface ChainSummary {
  chain: string;
  pools: number;
  error: string | null;
}

export interface PoolWarning {
  chain: string;
  category: string;
  message: string;
}

export interface PoolsRenderData {
  allChains: boolean;
  chainName: string;
  search: string | null;
  sort: string;
  filteredPools: PoolWithChain[];
  chainSummaries?: ChainSummary[];
  warnings: PoolWarning[];
}

// ── Helpers (moved from command) ─────────────────────────────────────────────

function formatStatAmount(
  value: bigint | undefined,
  decimals: number,
  symbol: string,
): string {
  if (value === undefined) return "-";
  return formatAmount(value, decimals, symbol, displayDecimals(decimals));
}

function formatDepositsCount(pool: PoolStats): string {
  if (pool.totalDepositsCount !== undefined) {
    return pool.totalDepositsCount.toLocaleString("en-US");
  }
  return "-";
}

export function poolToJson(
  pool: PoolStats,
  chain?: string,
): Record<string, string | number | null> {
  const payload: Record<string, string | number | null> = {
    asset: pool.symbol,
    tokenAddress: pool.asset,
    pool: pool.pool,
    scope: pool.scope.toString(),
    decimals: pool.decimals,
    minimumDeposit: pool.minimumDepositAmount.toString(),
    vettingFeeBPS: pool.vettingFeeBPS.toString(),
    maxRelayFeeBPS: pool.maxRelayFeeBPS.toString(),
    totalInPoolValue: pool.totalInPoolValue?.toString() ?? null,
    totalInPoolValueUsd: pool.totalInPoolValueUsd ?? null,
    totalDepositsValue: pool.totalDepositsValue?.toString() ?? null,
    totalDepositsValueUsd: pool.totalDepositsValueUsd ?? null,
    acceptedDepositsValue: pool.acceptedDepositsValue?.toString() ?? null,
    acceptedDepositsValueUsd: pool.acceptedDepositsValueUsd ?? null,
    pendingDepositsValue: pool.pendingDepositsValue?.toString() ?? null,
    pendingDepositsValueUsd: pool.pendingDepositsValueUsd ?? null,
    totalDepositsCount: pool.totalDepositsCount ?? null,
    acceptedDepositsCount: pool.acceptedDepositsCount ?? null,
    pendingDepositsCount: pool.pendingDepositsCount ?? null,
    growth24h: pool.growth24h ?? null,
    pendingGrowth24h: pool.pendingGrowth24h ?? null,
  };
  if (chain) payload.chain = chain;
  return payload;
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * Render "no pools found" (all raw pools empty, no errors to throw).
 */
export function renderPoolsEmpty(ctx: OutputContext, data: PoolsRenderData): void {
  if (ctx.mode.isJson) {
    if (data.allChains) {
      printJsonSuccess({ allChains: true, search: data.search, sort: data.sort, pools: [] });
    } else {
      printJsonSuccess({ chain: data.chainName, search: data.search, sort: data.sort, pools: [] });
    }
    return;
  }

  if (ctx.mode.isCsv) {
    printCsv(["Chain", "Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"], []);
    return;
  }

  const silent = isSilent(ctx);
  if (data.allChains) {
    info("No pools found across supported chains.", silent);
  } else {
    info(`No pools found on ${data.chainName}.`, silent);
  }
}

/**
 * Render populated pools listing.
 */
export function renderPools(ctx: OutputContext, data: PoolsRenderData): void {
  const { allChains, chainName, search, sort, filteredPools, chainSummaries, warnings } = data;

  const agentNextActions = [
    createNextAction("deposit", "Deposit into a pool.", "after_pools", {
      args: ["<amount>", "<asset>"],
      options: {
        agent: true,
        ...(allChains ? {} : { chain: chainName }),
      },
      runnable: false,
    }),
  ];
  const humanNextActions = [
    ...(filteredPools.length === 1
      ? [
          createNextAction("pools", "Open the detailed view for this pool.", "after_pools", {
            args: [filteredPools[0]!.pool.symbol],
            options: {
              chain: allChains ? filteredPools[0]!.chain : chainName,
            },
          }),
        ]
      : []),
    createNextAction("activity", "Review recent public activity before depositing.", "after_pools", {
      options: allChains ? undefined : { chain: chainName },
    }),
  ];

  if (ctx.mode.isJson) {
    if (allChains) {
      printJsonSuccess(appendNextActions({
        allChains: true,
        search,
        sort,
        chains: chainSummaries,
        pools: filteredPools.map((entry) => poolToJson(entry.pool, entry.chain)),
        warnings: warnings.length > 0 ? warnings : undefined,
      }, agentNextActions));
    } else {
      printJsonSuccess(appendNextActions({
        chain: chainName,
        search,
        sort,
        pools: filteredPools.map((entry) => poolToJson(entry.pool)),
      }, agentNextActions));
    }
    return;
  }

  if (ctx.mode.isCsv) {
    const csvHeaders = allChains
      ? ["Chain", "Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"]
      : ["Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"];
    printCsv(
      csvHeaders,
      filteredPools.map(({ chain, pool }) => {
        const dd = displayDecimals(pool.decimals);
        const baseRow = [
          pool.symbol,
          formatDepositsCount(pool),
          formatStatAmount(
            pool.totalInPoolValue ?? pool.acceptedDepositsValue,
            pool.decimals,
            pool.symbol,
          ),
          parseUsd(pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd),
          formatStatAmount(pool.pendingDepositsValue, pool.decimals, pool.symbol),
          formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol, dd),
          formatBPS(pool.vettingFeeBPS),
        ];
        return allChains ? [chain, ...baseRow] : baseRow;
      }),
    );
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;

  if (allChains) {
    process.stderr.write(`\n${accentBold("Pools across supported chains:")}\n\n`);
  } else {
    process.stderr.write(`\n${accentBold(`Pools on ${chainName}:`)}\n\n`);
  }

  if (warnings.length > 0) {
    process.stderr.write(
      formatCallout(
        "warning",
        warnings.map((warning) => `${warning.chain} (${warning.category}): ${warning.message}`),
      ),
    );
  }

  if (filteredPools.length === 0) {
    if (search && search.length > 0) {
      info(`No pools matched search query "${search}".`, false);
    } else {
      info("No pools found.", false);
    }
    return;
  }

  process.stderr.write(formatSectionHeading("Summary", { divider: true }));
  process.stderr.write(
    formatKeyValueRows([
      { label: "Chain", value: allChains ? "all supported chains" : chainName },
      { label: "Matched pools", value: String(filteredPools.length) },
      { label: "Sort", value: sort },
      ...(search ? [{ label: "Search", value: search }] : []),
    ]),
  );

  const headers = allChains
    ? ["Chain", "Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"]
    : ["Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"];
  if (getOutputWidthClass() === "wide") {
    printTable(
      headers,
      filteredPools.map(({ chain, pool }) => {
        const dd = displayDecimals(pool.decimals);
        const baseRow = [
          pool.symbol,
          formatDepositsCount(pool),
          formatStatAmount(
            pool.totalInPoolValue ?? pool.acceptedDepositsValue,
            pool.decimals,
            pool.symbol,
          ),
          parseUsd(pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd),
          formatStatAmount(
            pool.pendingDepositsValue,
            pool.decimals,
            pool.symbol,
          ),
          formatAmount(
            pool.minimumDepositAmount,
            pool.decimals,
            pool.symbol,
            dd,
          ),
          formatBPS(pool.vettingFeeBPS),
        ];
        return allChains ? [chain, ...baseRow] : baseRow;
      }),
    );
  } else {
    for (const { chain, pool } of filteredPools) {
      const dd = displayDecimals(pool.decimals);
      process.stderr.write(
        formatSectionHeading(
          allChains ? `${chain} · ${pool.symbol}` : pool.symbol,
          { divider: true },
        ),
      );
      process.stderr.write(
        formatStackedKeyValueRows([
          {
            label: "Pool Balance",
            value: formatStatAmount(
              pool.totalInPoolValue ?? pool.acceptedDepositsValue,
              pool.decimals,
              pool.symbol,
            ),
          },
          {
            label: "USD Value",
            value: parseUsd(pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd),
          },
          {
            label: "Pending",
            value: formatStatAmount(pool.pendingDepositsValue, pool.decimals, pool.symbol),
          },
          {
            label: "Min Deposit",
            value: formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol, dd),
          },
          {
            label: "Vetting Fee",
            value: formatBPS(pool.vettingFeeBPS),
          },
          {
            label: "Total Deposits",
            value: formatDepositsCount(pool),
          },
        ]),
      );
    }
  }
  process.stderr.write(
    chalk.dim(
      "\nVetting fees are deducted on deposit.\n" +
      "Pool Balance: current total value in the pool (accepted + pending deposits).\n" +
      "Pending: deposits still under ASP review.\n",
    ),
  );
  renderNextSteps(ctx, humanNextActions);
}

// ── Detail View ─────────────────────────────────────────────────────────────

export interface PoolDetailActivityEvent {
  type: string;
  amount: string | null;
  timeLabel: string;
  status: string | null;
}

export interface PoolDetailRenderData {
  chain: string;
  pool: PoolStats;
  tokenPrice: number | null;
  myPoolAccounts: PoolAccountRef[] | null;
  myFundsWarning?: string | null;
  recentActivity: PoolDetailActivityEvent[] | null;
}

function formatReviewSummary(poolAccounts: PoolAccountRef[]): string {
  const pendingCount = poolAccounts.filter((pa) => pa.status === "pending").length;
  const poiRequiredCount = poolAccounts.filter((pa) => pa.status === "poi_required").length;
  const declinedCount = poolAccounts.filter((pa) => pa.status === "declined").length;
  const unknownCount = poolAccounts.filter((pa) => pa.status === "unknown").length;
  const parts: string[] = [];

  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  if (poiRequiredCount > 0) parts.push(`${poiRequiredCount} PoA needed`);
  if (declinedCount > 0) parts.push(`${declinedCount} declined`);
  if (unknownCount > 0) parts.push(`${unknownCount} unknown`);

  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Render pool detail view: `pools <asset>`.
 */
export function renderPoolDetail(ctx: OutputContext, data: PoolDetailRenderData): void {
  const { chain, pool, tokenPrice, myPoolAccounts, myFundsWarning, recentActivity } = data;
  const dd = displayDecimals(pool.decimals);
  const hasUsd = tokenPrice !== null;
  const widthClass = getOutputWidthClass();

  guardCsvUnsupported(ctx, "pools <asset>");

  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      chain,
      ...poolToJson(pool),
    };

    if (myPoolAccounts !== null) {
      const active = myPoolAccounts.filter((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status));
      const myTotal = active.reduce((sum, pa) => sum + pa.value, 0n);
      payload.myFunds = {
        balance: myTotal.toString(),
        usdValue: hasUsd ? formatUsdValue(myTotal, pool.decimals, tokenPrice) : null,
        poolAccounts: active.length,
        pendingCount: active.filter((pa) => pa.status === "pending").length,
        poiRequiredCount: active.filter((pa) => pa.status === "poi_required").length,
        declinedCount: active.filter((pa) => pa.status === "declined").length,
        accounts: myPoolAccounts.map((pa) => ({
          id: pa.paId,
          status: pa.status,
          aspStatus: pa.aspStatus,
          value: pa.value.toString(),
        })),
      };
    } else {
      payload.myFunds = null;
    }

    if (myFundsWarning) {
      payload.myFundsWarning = myFundsWarning;
    }

    if (recentActivity !== null) {
      payload.recentActivity = recentActivity.map((event) => ({
        ...event,
        status: normalizePublicEventReviewStatus(event.type, event.status),
      }));
    }

    printJsonSuccess(payload, false);
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;

  process.stderr.write(`\n${accentBold(`${pool.symbol} Pool on ${chain}`)}\n`);
  const poolBalance = pool.totalInPoolValue ?? pool.acceptedDepositsValue;
  const poolBalanceUsd = pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd;
  const pendingFunds = pool.pendingDepositsValue;
  const pendingUsd = pool.pendingDepositsValueUsd;
  const allTimeDeposits = pool.totalDepositsValue;
  const allTimeUsd = pool.totalDepositsValueUsd;

  const fmtVal = (v: bigint | undefined): string =>
    v !== undefined ? formatAmount(v, pool.decimals, pool.symbol, dd) : "-";
  const fmtUsd = (v: string | null | undefined): string =>
    v ? ` (${parseUsd(v)})` : "";

  const summaryRows = [
    { label: "Pool Balance", value: `${fmtVal(poolBalance)}${fmtUsd(poolBalanceUsd)}` },
    { label: "Pending Funds", value: `${fmtVal(pendingFunds)}${fmtUsd(pendingUsd)}` },
    { label: "All-Time Deposits", value: `${fmtVal(allTimeDeposits)}${fmtUsd(allTimeUsd)}` },
    { label: "Total Deposits", value: formatDepositsCount(pool) },
    { label: "Vetting Fee", value: formatBPS(pool.vettingFeeBPS) },
    {
      label: "Min Deposit",
      value: formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol, dd),
    },
  ];
  process.stderr.write(formatSectionHeading("Pool summary", { divider: true }));
  process.stderr.write(
    widthClass === "wide"
      ? formatKeyValueRows(summaryRows)
      : formatStackedKeyValueRows(summaryRows),
  );

  process.stderr.write(
    formatCallout(
      "read-only",
      "Vetting fees are deducted on deposit. Pool balance includes accepted plus pending deposits.",
    ),
  );

  if (myPoolAccounts !== null) {
    const active = myPoolAccounts.filter((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status));
    const myTotal = active.reduce((sum, pa) => sum + pa.value, 0n);
    const usdFmt = hasUsd ? ` (${formatUsdValue(myTotal, pool.decimals, tokenPrice)})` : "";
    const myFundRows = [
      {
        label: "Available balance",
        value: `${formatAmount(myTotal, pool.decimals, pool.symbol, dd)}${usdFmt}`,
      },
      {
        label: "Active Pool Accounts",
        value: `${active.length}${formatReviewSummary(active)}`,
      },
    ];
    process.stderr.write(formatSectionHeading("Your funds", { divider: true }));
    process.stderr.write(
      widthClass === "wide"
        ? formatKeyValueRows(myFundRows)
        : formatStackedKeyValueRows(myFundRows),
    );

    if (active.length > 0) {
      if (widthClass === "wide") {
        printTable(
          ["Pool Account", "Balance", "Status"],
          active.map((pa) => [
            pa.paId,
            formatAmount(pa.value, pool.decimals, pool.symbol, dd),
            renderPoolAccountStatus(pa.status),
          ]),
        );
      } else {
        for (const pa of active) {
          process.stderr.write(
            formatSectionHeading(pa.paId, { divider: true }),
          );
          process.stderr.write(
            formatStackedKeyValueRows([
              {
                label: "Balance",
                value: formatAmount(pa.value, pool.decimals, pool.symbol, dd),
              },
              {
                label: "Status",
                value: renderPoolAccountStatus(pa.status),
              },
            ]),
          );
        }
      }
    }

    if (myFundsWarning) {
      process.stderr.write(formatCallout("warning", myFundsWarning));
    }

    if (active.some((pa) => pa.status === "declined")) {
      process.stderr.write(
        formatCallout(
          "recovery",
          "Declined Pool Accounts cannot use withdraw, including --direct. Use ragequit for public recovery to the deposit address.",
        ),
      );
    }

    if (active.some((pa) => pa.status === "poi_required")) {
      process.stderr.write(
        formatCallout(
          "recovery",
          `Proof of Association is still required before these balances can withdraw privately. Complete it at ${POA_PORTAL_URL}, or use ragequit if you prefer public recovery.`,
        ),
      );
    }
  } else {
    if (myFundsWarning) {
      process.stderr.write(formatSectionHeading("Your funds", { divider: true }));
      process.stderr.write(formatCallout("warning", myFundsWarning));
    } else {
      process.stderr.write(formatSectionHeading("Your funds", { divider: true }));
      process.stderr.write(
        formatCallout("read-only", "Run 'privacy-pools init' to see your balances here."),
      );
    }
  }

  process.stderr.write(formatSectionHeading("Recent activity", { divider: true }));
  if (recentActivity !== null && recentActivity.length > 0) {
    const activityRows = recentActivity.map((event) => [
      event.type === "withdrawal" ? "Withdraw" : event.type === "ragequit" ? "Ragequit" : "Deposit",
      event.amount ?? "-",
      event.timeLabel,
      renderAspApprovalStatus(
        normalizePublicEventReviewStatus(event.type, event.status),
        { preserveInput: true },
      ),
    ]);
    if (widthClass === "wide") {
      printTable(["Type", "Amount", "Time", "Status"], activityRows);
    } else {
      for (const [type, amount, time, status] of activityRows) {
        process.stderr.write(
          formatStackedKeyValueRows([
            { label: "Type", value: type },
            { label: "Amount", value: amount },
            { label: "Time", value: time },
            { label: "Status", value: status },
          ]),
        );
        process.stderr.write("\n");
      }
    }
  } else {
    process.stderr.write(
      formatCallout("read-only", "No recent public activity was returned for this pool."),
    );
  }

}
