/**
 * Output renderer for the `history` command.
 *
 * `src/commands/history.ts` delegates final output here.
 * Event extraction (buildHistoryEventsFromAccount), sync, pool discovery,
 * and spinner remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printCsv, printTable, info, isSilent, createNextAction, appendNextActions, renderNextSteps } from "./common.js";
import {
  formatAddress,
  formatAmount,
  formatTxHash,
  displayDecimals,
  formatApproxBlockTimeAgo,
  formatTimeAgo,
} from "../utils/format.js";
import {
  accentBold,
} from "../utils/theme.js";
import type { HistoryEvent } from "../commands/history.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryPoolInfo {
  pool: string;
  decimals: number;
}

export interface HistoryRenderData {
  mode: "private-history";
  chain: string;
  chainId: number;
  events: HistoryEvent[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  poolByAddress: Map<string, HistoryPoolInfo>;
  explorerTxUrl: (chainId: number, txHash: string) => string | null;
  /** Current block number for approximate relative timestamps. Null shows "-" instead. */
  currentBlock: bigint | null;
  /** Average seconds per block for the target chain (default 12 for Ethereum L1). */
  avgBlockTimeSec?: number;
  lastSyncTime?: number | null;
  syncSkipped?: boolean;
}

function renderHistoryType(type: HistoryEvent["type"]): string {
  switch (type) {
    case "deposit":
      return "Deposit";
    case "migration":
      return "Migration";
    case "withdrawal":
      return "Withdraw";
    default:
      return "Ragequit";
  }
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * Render "no pools found" for history.
 */
export function renderHistoryNoPools(
  ctx: OutputContext,
  data: {
    mode?: "private-history";
    chain: string;
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
    lastSyncTime?: number | null;
    syncSkipped?: boolean;
  },
): void {
  const agentNextActions = [
    createNextAction("pools", "Browse pools before making your first deposit.", "after_history", {
      options: { agent: true, chain: data.chain },
    }),
  ];
  const humanNextActions = [
    createNextAction("pools", "Browse pools before making your first deposit.", "after_history", {
      options: { chain: data.chain },
    }),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      mode: data.mode ?? "private-history",
      chain: data.chain,
      page: data.page ?? 1,
      perPage: data.perPage ?? 50,
      total: data.total ?? 0,
      totalPages: data.totalPages ?? 0,
      ...(data.lastSyncTime != null
        ? { lastSyncTime: new Date(data.lastSyncTime).toISOString() }
        : {}),
      syncSkipped: data.syncSkipped ?? false,
      events: [],
    }, agentNextActions));
    return;
  }
  if (ctx.mode.isCsv) {
    printCsv(["Type", "PA", "Amount", "Tx", "Time", "Block"], []);
    return;
  }
  info(`No history events found on ${data.chain}.`, isSilent(ctx));
  renderNextSteps(ctx, humanNextActions);
}

/**
 * Render history event listing.
 */
export function renderHistory(ctx: OutputContext, data: HistoryRenderData): void {
  const {
    mode,
    chain,
    chainId,
    events,
    page,
    perPage,
    total,
    totalPages,
    poolByAddress,
    explorerTxUrl,
    currentBlock,
    avgBlockTimeSec,
    lastSyncTime,
    syncSkipped,
  } = data;
  const nextActions = [
    createNextAction("accounts", "View current Pool Account balances and statuses.", "after_history", { options: { chain } }),
    createNextAction("pools", "Browse pools to make your first deposit.", "after_history", {
      options: { chain },
    }),
    createNextAction("deposit", "Deposit into a pool once you choose an amount and asset.", "after_history", {
      options: { chain },
      runnable: false,
      parameters: [
        { name: "amount", type: "token_amount", required: true },
        { name: "asset", type: "asset_symbol", required: true },
      ],
    }),
  ];

  if (ctx.mode.isJson) {
    const agentNextActions = nextActions.map((action) =>
      createNextAction(action.command, action.reason, action.when, {
        ...(action.args ? { args: action.args } : {}),
        ...(action.parameters ? { parameters: action.parameters } : {}),
        ...(action.runnable === false ? { runnable: false } : {}),
        options: { ...(action.options ?? {}), agent: true },
      }),
    );
    printJsonSuccess(appendNextActions({
      mode,
      chain,
      page,
      perPage,
      total,
      totalPages,
      ...(lastSyncTime != null ? { lastSyncTime: new Date(lastSyncTime).toISOString() } : {}),
      syncSkipped: syncSkipped ?? false,
      events: events.map((e) => ({
        type: e.type,
        asset: e.asset,
        poolAddress: e.poolAddress,
        poolAccountNumber: e.paNumber,
        poolAccountId: e.paId,
        value: e.value.toString(),
        blockNumber: e.blockNumber.toString(),
        txHash: e.txHash,
        explorerUrl: explorerTxUrl(chainId, e.txHash),
      })),
    }, agentNextActions));
    return;
  }

  if (ctx.mode.isCsv) {
    printCsv(
      ["Type", "PA", "Amount", "Tx", "Time", "Block"],
      events.map((e) => {
        const pool = poolByAddress.get(e.poolAddress);
        return [
          e.type === "ragequit" ? "Ragequit" : e.type === "withdrawal" ? "Withdraw" : e.type === "migration" ? "Migration" : "Deposit",
          e.paId,
          formatAmount(e.value, pool?.decimals ?? 18, e.asset, displayDecimals(pool?.decimals ?? 18)),
          e.txHash,
          currentBlock != null
            ? formatApproxBlockTimeAgo(currentBlock, e.blockNumber, avgBlockTimeSec)
            : "-",
          e.blockNumber.toString(),
        ];
      }),
    );
    return;
  }

  if (ctx.mode.isName) {
    const lines = events.map((event) => event.txHash);
    if (lines.length > 0) {
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    return;
  }

  const silent = isSilent(ctx);

  if (events.length === 0) {
    if (!silent) process.stderr.write("\n");
    info(`No history events found on ${chain}.`, silent);
    if (!silent && syncSkipped && lastSyncTime != null) {
      process.stderr.write(`Cached ${formatTimeAgo(lastSyncTime)}. Re-run sync to refresh.\n`);
    }
    renderNextSteps(ctx, nextActions);
    return;
  }

  if (silent) return;

  process.stderr.write(
    `\n${accentBold(`History on ${chain} (page ${page} of ${Math.max(totalPages, 1)}, ${total} total events):`)}\n\n`,
  );
  if (syncSkipped && lastSyncTime != null) {
    process.stderr.write(`Cached ${formatTimeAgo(lastSyncTime)}. Re-run sync to refresh.\n\n`);
  }
  const isWideFormat = ctx.mode.isWide;
  const historyHeaders = isWideFormat
    ? ["Type", "PA", "Amount", "Tx", "Time", "Block", "Pool"]
    : ["Type", "PA", "Amount", "Tx", "Time"];
  printTable(
    historyHeaders,
    events.map((e) => {
      const pool = poolByAddress.get(e.poolAddress);
      const row = [
        renderHistoryType(e.type),
        e.paId,
        formatAmount(e.value, pool?.decimals ?? 18, e.asset, displayDecimals(pool?.decimals ?? 18)),
        formatTxHash(e.txHash),
        currentBlock != null
          ? formatApproxBlockTimeAgo(currentBlock, e.blockNumber, avgBlockTimeSec)
          : "-",
      ];
      if (isWideFormat) {
        row.push(e.blockNumber.toString(), formatAddress(e.poolAddress, 8));
      }
      return row;
    }),
  );
  process.stderr.write("\n");
}
