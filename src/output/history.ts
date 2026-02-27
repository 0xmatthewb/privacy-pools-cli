/**
 * Output renderer for the `history` command.
 *
 * `src/commands/history.ts` delegates final output here.
 * Event extraction (buildHistoryEventsFromAccount), sync, pool discovery,
 * and spinner remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printTable } from "./common.js";
import { formatAmount, formatTxHash } from "../utils/format.js";
import type { HistoryEvent } from "../commands/history.js";

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
  process.stderr.write(`No pools found on ${chain}.\n`);
}

/**
 * Render history event listing.
 */
export function renderHistory(ctx: OutputContext, data: HistoryRenderData): void {
  const { chain, chainId, events, poolByAddress, explorerTxUrl } = data;

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

  if (events.length === 0) {
    process.stderr.write(`\nNo events found on ${chain}.\n`);
    return;
  }

  process.stderr.write(`\nHistory on ${chain} (last ${events.length} events):\n\n`);
  printTable(
    ["Block", "Type", "PA", "Amount", "Tx"],
    events.map((e) => {
      const pool = poolByAddress.get(e.poolAddress);
      const typeLabel =
        e.type === "deposit" ? "Deposit" :
        e.type === "withdrawal" ? "Withdraw" :
        "Ragequit";
      return [
        e.blockNumber.toString(),
        typeLabel,
        e.paId,
        formatAmount(e.value, pool?.decimals ?? 18, e.asset),
        formatTxHash(e.txHash),
      ];
    }),
  );
  process.stderr.write("\n");
}
