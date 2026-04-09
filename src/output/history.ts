/**
 * Output renderer for the `history` command.
 *
 * `src/commands/history.ts` delegates final output here.
 * Event extraction (buildHistoryEventsFromAccount), sync, pool discovery,
 * and spinner remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printCsv, printTable, info, isSilent } from "./common.js";
import { formatAmount, formatTxHash, displayDecimals, formatApproxBlockTimeAgo } from "../utils/format.js";
import {
  accentBold,
  directionDeposit,
  directionRecovery,
  directionWithdraw,
} from "../utils/theme.js";
import type { HistoryEvent } from "../commands/history.js";
import { formatKeyValueRows, formatSectionHeading } from "./layout.js";
import { glyph } from "../utils/symbols.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryPoolInfo {
  pool: string;
  decimals: number;
}

export interface HistoryRenderData {
  chain: string;
  chainId: number;
  events: HistoryEvent[];
  poolByAddress: Map<string, HistoryPoolInfo>;
  explorerTxUrl: (chainId: number, txHash: string) => string | null;
  /** Current block number for approximate relative timestamps. Null shows "-" instead. */
  currentBlock: bigint | null;
  /** Average seconds per block for the target chain (default 12 for Ethereum L1). */
  avgBlockTimeSec?: number;
}

function renderHistoryType(type: HistoryEvent["type"]): string {
  switch (type) {
    case "deposit":
      return `${directionDeposit(glyph("deposit"))} Deposit`;
    case "migration":
      return `${directionDeposit(glyph("deposit"))} Migration`;
    case "withdrawal":
      return `${directionWithdraw(glyph("withdraw"))} Withdraw`;
    default:
      return `${directionRecovery(glyph("recovery"))} Recovery`;
  }
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * Render "no pools found" for history.
 */
export function renderHistoryNoPools(ctx: OutputContext, chain: string): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({ chain, events: [] });
    return;
  }
  if (ctx.mode.isCsv) {
    printCsv(["Type", "PA", "Amount", "Tx", "Block"], []);
    return;
  }
  info(`No history events are available on ${chain} yet.`, isSilent(ctx));
}

/**
 * Render history event listing.
 */
export function renderHistory(ctx: OutputContext, data: HistoryRenderData): void {
  const { chain, chainId, events, poolByAddress, explorerTxUrl, currentBlock, avgBlockTimeSec } = data;

  if (ctx.mode.isJson) {
    printJsonSuccess({
      chain,
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
    });
    return;
  }

  if (ctx.mode.isCsv) {
    printCsv(
      ["Type", "PA", "Amount", "Tx", "Block"],
      events.map((e) => {
        const pool = poolByAddress.get(e.poolAddress);
        return [
          e.type === "ragequit" ? "Recovery" : e.type === "withdrawal" ? "Withdraw" : e.type === "migration" ? "Migration" : "Deposit",
          e.paId,
          formatAmount(e.value, pool?.decimals ?? 18, e.asset, displayDecimals(pool?.decimals ?? 18)),
          e.txHash,
          e.blockNumber.toString(),
        ];
      }),
    );
    return;
  }

  const silent = isSilent(ctx);

  if (events.length === 0) {
    if (!silent) process.stderr.write("\n");
    info(`No events found on ${chain}.`, silent);
    return;
  }

  if (silent) return;

  process.stderr.write(`\n${accentBold(`History on ${chain} (last ${events.length} events):`)}\n\n`);
  process.stderr.write(formatSectionHeading("Summary", { divider: true }));
  process.stderr.write(
    formatKeyValueRows([
      { label: "Chain", value: chain },
      { label: "Events", value: String(events.length) },
      {
        label: "Current block",
        value: currentBlock === null ? "unknown" : currentBlock.toString(),
      },
    ]),
  );
  printTable(
    ["Type", "PA", "Amount", "Tx", "Time"],
    events.map((e) => {
      const pool = poolByAddress.get(e.poolAddress);
      return [
        renderHistoryType(e.type),
        e.paId,
        formatAmount(e.value, pool?.decimals ?? 18, e.asset, displayDecimals(pool?.decimals ?? 18)),
        formatTxHash(e.txHash),
        currentBlock != null
          ? formatApproxBlockTimeAgo(currentBlock, e.blockNumber, avgBlockTimeSec)
          : "-",
      ];
    }),
  );
  process.stderr.write("\n");
}
