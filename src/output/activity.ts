/**
 * Output renderer for the `activity` command.
 *
 * `src/commands/activity.ts` delegates final output here.
 * Event fetching, normalization, pagination, and spinner remain in
 * the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printTable, isSilent } from "./common.js";
import { formatAddress } from "../utils/format.js";

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
  page: number;
  perPage: number;
  total: number | null;
  totalPages: number | null;
  events: NormalizedActivityEvent[];
  /** Pool-specific fields (pool-activity mode only). */
  asset?: string;
  pool?: string;
  scope?: string;
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
    printJsonSuccess(payload, false);
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;

  const header =
    data.mode === "pool-activity"
      ? `\nActivity for ${data.asset} on ${data.chain}:\n\n`
      : `\nGlobal activity (${data.chain} endpoint):\n\n`;
  process.stderr.write(header);

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
}
