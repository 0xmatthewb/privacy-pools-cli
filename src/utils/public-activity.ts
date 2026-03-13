import { displayDecimals, formatAmount, formatTimeAgo } from "./format.js";
import { extractPublicEventReviewStatus } from "./statuses.js";
import type { AspPublicEvent } from "../types.js";

export interface NormalizedPublicActivityEvent {
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

export function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toMsTimestamp(value: unknown): number | null {
  const parsed = parseNumberish(value);
  if (parsed === null) return null;
  return parsed < 1e12 ? Math.floor(parsed * 1000) : Math.floor(parsed);
}

export function normalizeActivityEvent(
  event: AspPublicEvent,
  fallbackSymbol?: string,
): NormalizedPublicActivityEvent {
  const pool = event.pool ?? {};
  const chainId = parseNumberish(pool.chainId);
  const amountRaw =
    typeof event.amount === "string"
      ? event.amount
      : typeof event.publicAmount === "string"
        ? event.publicAmount
        : null;

  const symbol =
    typeof pool.tokenSymbol === "string" && pool.tokenSymbol.trim() !== ""
      ? pool.tokenSymbol
      : fallbackSymbol ?? null;
  const decimals = parseNumberish(pool.denomination) ?? 18;

  let amountFormatted = "-";
  if (amountRaw && /^-?\d+$/.test(amountRaw)) {
    try {
      amountFormatted = formatAmount(
        BigInt(amountRaw),
        decimals,
        symbol ?? undefined,
        displayDecimals(decimals),
      );
    } catch {
      amountFormatted = amountRaw;
    }
  } else if (amountRaw) {
    amountFormatted = amountRaw;
  }

  const timestampMs = toMsTimestamp(event.timestamp);

  return {
    type: typeof event.type === "string" ? event.type : "unknown",
    txHash: typeof event.txHash === "string" ? event.txHash : null,
    reviewStatus: extractPublicEventReviewStatus(event.reviewStatus),
    amountRaw,
    amountFormatted,
    timestampMs,
    timeLabel: formatTimeAgo(timestampMs),
    poolSymbol: symbol,
    poolAddress: typeof pool.poolAddress === "string" ? pool.poolAddress : null,
    chainId,
  };
}
