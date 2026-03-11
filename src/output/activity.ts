/**
 * Output renderer for the `activity` command.
 *
 * `src/commands/activity.ts` delegates final output here.
 * Event fetching, normalization, pagination, and spinner remain in
 * the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printCsv, printTable, isSilent } from "./common.js";
import { formatAddress } from "../utils/format.js";
import { accentBold } from "../utils/theme.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface NormalizedActivityEvent {
  type: string;
  txHash: string | null;
  reviewStatus: string | null;
  amountRaw: string | null;
  amountFormatted: string;
  timestampMs: number | null;
  timeLabel: string;
  poolSymbol: string | null;
  poolAddress: string | null;
  chainId: number | null;
}

export interface ActivityRenderData {
  mode: "pool-activity" | "global-activity";
  chain: string;
  /** When multiple chains are queried, lists the chain names. */
  chains?: string[];
  page: number;
  perPage: number;
  total: number | null;
  totalPages: number | null;
  events: NormalizedActivityEvent[];
  /** Pool-specific fields (pool-activity mode only). */
  asset?: string;
  pool?: string;
  scope?: string;
  /** True when events were filtered client-side by chain, making pagination totals unavailable. */
  chainFiltered?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function eventPoolLabel(event: NormalizedActivityEvent): string {
  if (event.poolSymbol && event.chainId !== null) {
    return `${event.poolSymbol}@${event.chainId}`;
  }
  if (event.poolSymbol) return event.poolSymbol;
  if (event.chainId !== null) return `chain-${event.chainId}`;
  return "-";
}

// ── Renderers ────────────────────────────────────────────────────────────────

export function renderActivity(ctx: OutputContext, data: ActivityRenderData): void {
  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      mode: data.mode,
      chain: data.chain,
      ...(data.chains ? { chains: data.chains } : {}),
      page: data.page,
      perPage: data.perPage,
      total: data.total,
      totalPages: data.totalPages,
      events: data.events.map((e) => ({
        type: e.type,
        txHash: e.txHash,
        reviewStatus: e.reviewStatus,
        amountRaw: e.amountRaw,
        poolSymbol: e.poolSymbol,
        poolAddress: e.poolAddress,
        chainId: e.chainId,
        timestamp: e.timestampMs,
      })),
    };
    if (data.mode === "pool-activity") {
      payload.asset = data.asset;
      payload.pool = data.pool;
      payload.scope = data.scope;
    }
    if (data.chainFiltered) {
      payload.chainFiltered = true;
      payload.note = "Pagination totals are unavailable when filtering by chain. Results may be sparse.";
    }
    printJsonSuccess(payload, false);
    return;
  }

  if (ctx.mode.isCsv) {
    printCsv(
      ["Type", "Pool", "Amount", "Status", "Time", "Tx"],
      data.events.map((e) => [
        e.type,
        eventPoolLabel(e),
        e.amountFormatted,
        e.reviewStatus ?? "-",
        e.timeLabel,
        e.txHash ? formatAddress(e.txHash, 8) : "-",
      ]),
    );
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;

  const chainLabel = data.chains ? data.chains.join(", ") : data.chain;
  const header =
    data.mode === "pool-activity"
      ? accentBold(`Activity for ${data.asset} on ${data.chain}:`)
      : accentBold(`Global activity (${chainLabel}):`);
  process.stderr.write(`\n${header}\n\n`);

  if (data.events.length === 0) {
    process.stderr.write("No activity found.\n");
    return;
  }

  printTable(
    ["Type", "Pool", "Amount", "Status", "Time", "Tx"],
    data.events.map((e) => [
      e.type,
      eventPoolLabel(e),
      e.amountFormatted,
      e.reviewStatus ?? "-",
      e.timeLabel,
      e.txHash ? formatAddress(e.txHash, 8) : "-",
    ]),
  );

  // Pagination footer
  if (data.totalPages !== null && data.totalPages > 1) {
    process.stderr.write(
      `\n  Page ${data.page} of ${data.totalPages}` +
        (data.total !== null ? ` (${data.total} events)` : "") +
        (data.page < data.totalPages ? `. Next: --page ${data.page + 1}` : "") +
        "\n",
    );
  }

  if (data.chainFiltered) {
    process.stderr.write(
      `\n  Note: Results filtered to ${data.chain}. Some pages may be sparse.\n`,
    );
  }
}
