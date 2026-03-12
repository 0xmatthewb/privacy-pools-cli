/**
 * Output renderer for the `pools` command.
 *
 * `src/commands/pools.ts` delegates final output here.
 * Pool fetching, search, sort, and spinner remain in the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import { appendNextActions, createNextAction, renderNextSteps, guardCsvUnsupported, printJsonSuccess, printCsv, printTable, info, warn, isSilent } from "./common.js";
import { accentBold } from "../utils/theme.js";
import { formatAmount, formatBPS, displayDecimals, parseUsd, formatUsdValue } from "../utils/format.js";
import type { PoolStats } from "../types.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";

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
  /** True when the CLI is initialized (config + mnemonic exist). When false,
   *  next-step guidance is suppressed — suggesting `deposit` to a user who
   *  hasn't run `init` yet is misleading. */
  setupReady?: boolean;
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

  // ── Next-step guidance (shared across JSON / human paths) ────────────
  // Suppressed entirely when the CLI is not initialized — suggesting
  // `deposit` to a first-run user who hasn't run `init` is misleading.
  const showNextSteps = data.setupReady !== false && filteredPools.length > 0;

  const agentNextActions = showNextSteps
    ? [
        createNextAction(
          "deposit",
          allChains
            ? "Choose a pool from the results, then deposit into it."
            : "Deposit into a pool after reviewing its terms.",
          "after_browse",
          {
            options: {
              agent: true,
              ...(!allChains ? { chain: chainName } : {}),
            },
            runnable: false,
          },
        ),
      ]
    : undefined;

  const humanNextActions = showNextSteps
    ? [
        createNextAction(
          "deposit",
          allChains
            ? "Choose a pool from the results, then deposit into it."
            : "Deposit into a pool after reviewing its terms.",
          "after_browse",
          {
            options: !allChains ? { chain: chainName } : undefined,
            runnable: false,
          },
        ),
      ]
    : undefined;

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
    for (const warning of warnings) {
      warn(`${warning.chain} (${warning.category}): ${warning.message}`, false);
    }
    process.stderr.write("\n");
  }

  if (filteredPools.length === 0) {
    if (search && search.length > 0) {
      info(`No pools matched search query "${search}".`, false);
    } else {
      info("No pools found.", false);
    }
    return;
  }

  const headers = allChains
    ? ["Chain", "Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"]
    : ["Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"];

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
  process.stderr.write(
    chalk.dim(
      "\nVetting fees are deducted on deposit.\n" +
      "Pool Balance: current total value in the pool (accepted + pending deposits).\n" +
      "Pending: deposits awaiting ASP review (most approve within 1 hour, up to 7 days).\n",
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
  recentActivity: PoolDetailActivityEvent[] | null;
  /** See PoolsRenderData.setupReady — same semantics. */
  setupReady?: boolean;
}

/**
 * Render pool detail view: `pools <asset>`.
 */
export function renderPoolDetail(ctx: OutputContext, data: PoolDetailRenderData): void {
  const { chain, pool, tokenPrice, myPoolAccounts, recentActivity } = data;
  const dd = displayDecimals(pool.decimals);
  const hasUsd = tokenPrice !== null;

  guardCsvUnsupported(ctx, "pools <asset>");

  if (ctx.mode.isJson) {
    // Agents benefit from structured nextActions; human path stays quiet
    // because "deposit" is obvious after viewing pool details and requires user-supplied amount.
    // Suppressed when the CLI is not initialized (same gate as list view).
    const nextActions = data.setupReady !== false
      ? [
          createNextAction(
            "deposit",
            "Deposit into this pool if its terms work for you.",
            "after_pool_detail",
            {
              options: {
                agent: true,
                chain,
                asset: pool.symbol,
              },
              runnable: false,
            },
          ),
        ]
      : undefined;
    const payload: Record<string, unknown> = appendNextActions({
      chain,
      ...poolToJson(pool),
    }, nextActions) as Record<string, unknown>;

    if (myPoolAccounts !== null) {
      const spendable = myPoolAccounts.filter((pa) => pa.status === "spendable");
      const myTotal = spendable.reduce((sum, pa) => sum + pa.value, 0n);
      payload.myFunds = {
        balance: myTotal.toString(),
        usdValue: hasUsd ? formatUsdValue(myTotal, pool.decimals, tokenPrice) : null,
        poolAccounts: spendable.length,
        pendingCount: spendable.filter((pa) => pa.aspStatus === "pending").length,
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

    if (recentActivity !== null) {
      payload.recentActivity = recentActivity;
    }

    printJsonSuccess(payload, false);
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;

  // ── Pool stats ──
  process.stderr.write(`\n${accentBold(`${pool.symbol} Pool on ${chain}`)}\n`);
  process.stderr.write(chalk.dim("─".repeat(44)) + "\n");

  const poolBalance = pool.totalInPoolValue ?? pool.acceptedDepositsValue;
  const poolBalanceUsd = pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd;
  const pendingFunds = pool.pendingDepositsValue;
  const pendingUsd = pool.pendingDepositsValueUsd;
  const allTimeDeposits = pool.totalDepositsValue;
  const allTimeUsd = pool.totalDepositsValueUsd;

  const fmtVal = (v: bigint | undefined): string =>
    v !== undefined ? formatAmount(v, pool.decimals, pool.symbol, dd) : "-";
  const fmtUsd = (v: string | null | undefined): string =>
    v ? `  (${parseUsd(v)})` : "";

  process.stderr.write(`  Pool Balance:      ${fmtVal(poolBalance)}${fmtUsd(poolBalanceUsd)}\n`);
  process.stderr.write(`  Pending Funds:     ${fmtVal(pendingFunds)}${fmtUsd(pendingUsd)}\n`);
  process.stderr.write(`  All-Time Deposits: ${fmtVal(allTimeDeposits)}${fmtUsd(allTimeUsd)}\n`);
  process.stderr.write(`  Total Deposit #:   ${formatDepositsCount(pool)}\n`);
  process.stderr.write(`  Vetting Fee:       ${formatBPS(pool.vettingFeeBPS)}\n`);
  process.stderr.write(`  Min Deposit:       ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol, dd)}\n`);

  // ── My Funds section ──
  process.stderr.write("\n");
  if (myPoolAccounts !== null) {
    const spendable = myPoolAccounts.filter((pa) => pa.status === "spendable");
    const myTotal = spendable.reduce((sum, pa) => sum + pa.value, 0n);
    const pendingCount = spendable.filter((pa) => pa.aspStatus === "pending").length;
    const usdFmt = hasUsd ? `  (${formatUsdValue(myTotal, pool.decimals, tokenPrice)})` : "";
    process.stderr.write(`  My Funds:          ${formatAmount(myTotal, pool.decimals, pool.symbol, dd)}${usdFmt}\n`);
    process.stderr.write(`  My Pool Accounts:  ${spendable.length}${pendingCount > 0 ? ` (${pendingCount} pending)` : ""}\n`);

    if (spendable.length > 0) {
      process.stderr.write("\n");
      for (const pa of spendable) {
        const aspLabel = pa.aspStatus === "approved"
          ? chalk.green("Approved")
          : pa.aspStatus === "pending"
            ? chalk.yellow("Pending")
            : "";
        const valFmt = formatAmount(pa.value, pool.decimals, pool.symbol, dd);
        process.stderr.write(`  ${pa.paId}  ${valFmt}  Spendable (${aspLabel})\n`);
      }
    }
  } else {
    process.stderr.write(chalk.dim(`  Run 'privacy-pools init' to see your funds here.\n`));
  }

  // ── Recent Activity section ──
  if (recentActivity !== null && recentActivity.length > 0) {
    process.stderr.write(`\n${chalk.dim("Recent Activity:")}\n`);
    for (const event of recentActivity) {
      const typeFmt = event.type === "deposit" ? "Deposit " :
        event.type === "withdrawal" ? "Withdraw" : event.type.padEnd(8);
      const amt = event.amount ?? "-";
      const time = event.timeLabel;
      const status = event.status ?? "";
      process.stderr.write(`  ${typeFmt}  ${amt.padEnd(18)}  ${time.padEnd(10)}  ${status}\n`);
    }
  }

}
