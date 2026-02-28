/**
 * Output renderer for the `pools` command.
 *
 * `src/commands/pools.ts` delegates final output here.
 * Pool fetching, search, sort, and spinner remain in the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import { printJsonSuccess, printTable, info, warn, isSilent } from "./common.js";
import { formatAddress, formatAmount, formatBPS } from "../utils/format.js";
import type { PoolStats } from "../types.js";

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
  return formatAmount(value, decimals, symbol);
}

function formatDepositsSummary(pool: PoolStats): string {
  const count =
    pool.totalDepositsCount !== undefined
      ? pool.totalDepositsCount.toLocaleString("en-US")
      : null;
  const value =
    pool.totalDepositsValue !== undefined
      ? formatAmount(pool.totalDepositsValue, pool.decimals, pool.symbol)
      : null;

  if (count && value) return `${count} (${value})`;
  return count ?? value ?? "-";
}

export function poolToJson(
  pool: PoolStats,
  chain?: string,
): Record<string, string | number | null> {
  const payload: Record<string, string | number | null> = {
    symbol: pool.symbol,
    asset: pool.asset,
    pool: pool.pool,
    scope: pool.scope.toString(),
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

  if (ctx.mode.isJson) {
    if (allChains) {
      printJsonSuccess({
        allChains: true,
        search,
        sort,
        chains: chainSummaries,
        pools: filteredPools.map((entry) => poolToJson(entry.pool, entry.chain)),
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } else {
      printJsonSuccess({
        chain: chainName,
        search,
        sort,
        pools: filteredPools.map((entry) => poolToJson(entry.pool)),
      });
    }
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;

  if (allChains) {
    process.stderr.write("\nPools across supported chains:\n\n");
  } else {
    process.stderr.write(`\nPools on ${chainName}:\n\n`);
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

  printTable(
    allChains
      ? ["Chain", "Asset", "TVL", "Pending", "Deposits", "Min Deposit", "Vetting Fee", "Relay Fee"]
      : ["Asset", "TVL", "Pending", "Deposits", "Min Deposit", "Vetting Fee", "Relay Fee"],
    filteredPools.map(({ chain, pool }) => {
      const baseRow = [
        pool.symbol,
        formatStatAmount(
          pool.acceptedDepositsValue ?? pool.totalInPoolValue,
          pool.decimals,
          pool.symbol,
        ),
        formatStatAmount(
          pool.pendingDepositsValue,
          pool.decimals,
          pool.symbol,
        ),
        formatDepositsSummary(pool),
        formatAmount(
          pool.minimumDepositAmount,
          pool.decimals,
          pool.symbol,
        ),
        formatBPS(pool.vettingFeeBPS),
        formatBPS(pool.maxRelayFeeBPS),
      ];
      return allChains ? [chain, ...baseRow] : baseRow;
    }),
  );
  process.stderr.write(
    chalk.dim(
      "\nVetting fees are deducted on deposit. Relay fees apply to relayed withdrawals.\n",
    ),
  );
}
