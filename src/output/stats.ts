/**
 * Output renderer for the `stats` command.
 *
 * `src/commands/stats.ts` delegates final output here.
 * Statistics fetching, subcommand routing, and spinner remain in
 * the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printCsv, printTable, isSilent, createNextAction, appendNextActions, renderNextSteps } from "./common.js";
import { accentBold } from "../utils/theme.js";
import { parseUsd } from "../utils/format.js";
import type { TimeBasedStatistics } from "../types.js";
import {
  formatKeyValueRows,
  formatSectionHeading,
  formatStackedKeyValueRows,
  getOutputWidthClass,
} from "./layout.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChainStatsEntry {
  chain: string;
  cacheTimestamp: string | null;
  allTime: TimeBasedStatistics | null;
  last24h: TimeBasedStatistics | null;
}

export interface GlobalStatsRenderData {
  mode: "global-stats";
  chain: string;
  /** When multiple chains are queried, lists the chain names. */
  chains?: string[];
  cacheTimestamp: string | null;
  allTime: TimeBasedStatistics | null;
  last24h: TimeBasedStatistics | null;
  /** Per-chain results when multi-chain. */
  perChain?: ChainStatsEntry[];
}

export interface PoolStatsRenderData {
  mode: "pool-stats";
  chain: string;
  asset: string;
  pool: string;
  scope: string;
  cacheTimestamp: string | null;
  allTime: TimeBasedStatistics | null;
  last24h: TimeBasedStatistics | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// parseUsd is now in ../utils/format.ts — re-exported here for test compat.
export { parseUsd } from "../utils/format.js";

/** @internal Exported for unit testing. */
export function parseCount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value).toLocaleString("en-US");
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed).toLocaleString("en-US");
    }
  }
  return "-";
}

function statsRows(
  allTime: TimeBasedStatistics | undefined | null,
  last24h: TimeBasedStatistics | undefined | null,
): string[][] {
  return [
    ["Current TVL", parseUsd(allTime?.tvlUsd), parseUsd(last24h?.tvlUsd)],
    ["Avg Deposit Size", parseUsd(allTime?.avgDepositSizeUsd), parseUsd(last24h?.avgDepositSizeUsd)],
    ["Total Deposits", parseCount(allTime?.totalDepositsCount), parseCount(last24h?.totalDepositsCount)],
    ["Total Withdrawals", parseCount(allTime?.totalWithdrawalsCount), parseCount(last24h?.totalWithdrawalsCount)],
  ];
}

function renderStatsTable(
  allTime: TimeBasedStatistics | undefined | null,
  last24h: TimeBasedStatistics | undefined | null,
): void {
  printTable(["Metric", "All Time", "Last 24h"], statsRows(allTime, last24h));
}

function renderStatsBlocks(
  allTime: TimeBasedStatistics | undefined | null,
  last24h: TimeBasedStatistics | undefined | null,
): void {
  process.stderr.write(formatSectionHeading("All time", { divider: true }));
  process.stderr.write(
    formatStackedKeyValueRows(
      statsRows(allTime, last24h).map(([metric, value]) => ({
        label: metric,
        value,
      })),
    ),
  );
  process.stderr.write(formatSectionHeading("Last 24h", { divider: true }));
  process.stderr.write(
    formatStackedKeyValueRows(
      statsRows(allTime, last24h).map(([metric, , value]) => ({
        label: metric,
        value,
      })),
    ),
  );
}

// ── Renderers ────────────────────────────────────────────────────────────────

export function renderGlobalStats(ctx: OutputContext, data: GlobalStatsRenderData): void {
  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      mode: data.mode,
      chain: data.chain,
      ...(data.chains ? { chains: data.chains } : {}),
      cacheTimestamp: data.cacheTimestamp,
      allTime: data.allTime,
      last24h: data.last24h,
    };
    if (data.perChain) {
      payload.perChain = data.perChain;
    }
    const agentNextActions = [
      createNextAction("pools", "Browse live pool balances and minimum deposits.", "after_stats"),
    ];
    printJsonSuccess(appendNextActions(payload, agentNextActions), false);
    return;
  }

  if (ctx.mode.isCsv) {
    if (data.perChain && data.perChain.length > 0) {
      const rows: string[][] = [];
      for (const entry of data.perChain) {
        for (const row of statsRows(entry.allTime, entry.last24h)) {
          rows.push([entry.chain, ...row]);
        }
      }
      printCsv(["Chain", "Metric", "All Time", "Last 24h"], rows);
    } else {
      printCsv(["Metric", "All Time", "Last 24h"], statsRows(data.allTime, data.last24h));
    }
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;
  const renderTable = getOutputWidthClass() === "wide" || ctx.mode.isWide;

  if (data.perChain && data.perChain.length > 0) {
    for (const entry of data.perChain) {
      process.stderr.write(`\n${accentBold(`Global statistics (${entry.chain}):`)}\n\n`);
      process.stderr.write(formatSectionHeading("Summary", { divider: true }));
      process.stderr.write(
        formatKeyValueRows([
          { label: "Chain", value: entry.chain },
          ...(entry.cacheTimestamp
            ? [{ label: "Cache timestamp", value: entry.cacheTimestamp }]
            : []),
        ]),
      );
      if (renderTable) {
        renderStatsTable(entry.allTime, entry.last24h);
      } else {
        renderStatsBlocks(entry.allTime, entry.last24h);
      }
    }
  } else {
    process.stderr.write(`\n${accentBold(`Global statistics (${data.chain}):`)}\n\n`);
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: data.chain },
        ...(data.cacheTimestamp
          ? [{ label: "Cache timestamp", value: data.cacheTimestamp }]
          : []),
      ]),
    );
    if (renderTable) {
      renderStatsTable(data.allTime, data.last24h);
    } else {
      renderStatsBlocks(data.allTime, data.last24h);
    }
  }

  renderNextSteps(ctx, [
    createNextAction("pools", "Browse live pool balances and minimum deposits.", "after_stats"),
  ]);
}

export function renderPoolStats(ctx: OutputContext, data: PoolStatsRenderData): void {
  if (ctx.mode.isJson) {
    const agentNextActions = [
      createNextAction("pools", "Open the detailed view for this pool.", "after_pool_stats", {
        args: [data.asset],
        options: { agent: true, chain: data.chain },
      }),
    ];
    printJsonSuccess(
      appendNextActions({
        mode: data.mode,
        chain: data.chain,
        asset: data.asset,
        pool: data.pool,
        scope: data.scope,
        cacheTimestamp: data.cacheTimestamp,
        allTime: data.allTime,
        last24h: data.last24h,
      }, agentNextActions),
      false,
    );
    return;
  }

  if (ctx.mode.isCsv) {
    printCsv(["Metric", "All Time", "Last 24h"], statsRows(data.allTime, data.last24h));
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) {
    const renderTable = getOutputWidthClass() === "wide" || ctx.mode.isWide;
    process.stderr.write(`\n${accentBold(`Pool statistics for ${data.asset} on ${data.chain}:`)}\n\n`);
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Asset", value: data.asset },
        { label: "Chain", value: data.chain },
        ...(data.cacheTimestamp
          ? [{ label: "Cache timestamp", value: data.cacheTimestamp }]
          : []),
      ]),
    );
    if (renderTable) {
      renderStatsTable(data.allTime, data.last24h);
    } else {
      renderStatsBlocks(data.allTime, data.last24h);
    }
    renderNextSteps(ctx, [
      createNextAction("pools", "Open the detailed view for this pool.", "after_pool_stats", {
        args: [data.asset],
        options: { chain: data.chain },
      }),
    ]);
  }
}
