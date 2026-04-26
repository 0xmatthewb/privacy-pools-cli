/**
 * Output renderer for the `activity` command.
 *
 * `src/commands/activity.ts` delegates final output here.
 * Event fetching, normalization, pagination, and spinner remain in
 * the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printCsv, printTable, isSilent, createNextAction, appendNextActions, renderNextSteps } from "./common.js";
import { formatAddress } from "../utils/format.js";
import {
  accentBold,
  muted,
  successTone,
} from "../utils/theme.js";
import { explorerTxUrl } from "../config/chains.js";
import {
  normalizePublicEventReviewStatus,
  renderAspApprovalStatus,
} from "../utils/statuses.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
  formatStackedKeyValueRows,
  getOutputWidthClass,
} from "./layout.js";
import { inlineSeparator } from "../utils/terminal.js";

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
  /** Extra note when pagination metadata is unavailable or approximate. */
  note?: string;
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

function toIsoTimestamp(timestampMs: number | null): string | null {
  return timestampMs === null ? null : new Date(timestampMs).toISOString();
}

/** Completed withdrawals, ragequits, and migrations show "Completed" instead of "Approved". */
function isCompletedEventType(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t.includes("withdraw") || t.includes("ragequit") || t.includes("recovery") || t === "migration" || t === "exit";
}

function renderActivityStatus(type: string, reviewStatus: string | null): string {
  const normalized = normalizePublicEventReviewStatus(type, reviewStatus);
  if (isCompletedEventType(type) && normalized === "approved") {
    return successTone("Completed");
  }
  return renderAspApprovalStatus(normalized, { preserveInput: true });
}

function formatActivityStatusPlain(type: string, reviewStatus: string | null): string {
  const normalized = normalizePublicEventReviewStatus(type, reviewStatus);
  if (isCompletedEventType(type) && normalized === "approved") {
    return "Completed";
  }
  return normalized;
}

function renderActivityType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized.includes("deposit")) {
    return "Deposit";
  }
  if (normalized.includes("withdraw")) {
    return "Withdraw";
  }
  if (normalized.includes("ragequit") || normalized.includes("recovery")) {
    return "Ragequit";
  }
  return type;
}

// ── Renderers ────────────────────────────────────────────────────────────────

export function renderActivity(ctx: OutputContext, data: ActivityRenderData): void {
  const hasNextPage = data.totalPages !== null && data.page < data.totalPages;
  const paginationOptions: Record<string, string | number | boolean> = {
    page: data.page + 1,
    limit: data.perPage,
    ...(data.mode === "pool-activity" && data.asset ? { asset: data.asset } : {}),
    ...(data.chain !== "all-mainnets" ? { chain: data.chain } : {}),
  };
  const fallbackAgentNextActions = data.mode === "pool-activity" && data.asset
    ? [createNextAction("pools", "Return to pool discovery after reviewing this activity page.", "after_activity", {
        options: { agent: true, chain: data.chain },
      })]
    : [createNextAction("accounts", "Inspect current Pool Account balances after reviewing public activity.", "after_activity", {
        options: { agent: true, ...(data.chain !== "all-mainnets" ? { chain: data.chain } : {}) },
      })];
  const fallbackHumanNextActions = data.mode === "pool-activity" && data.asset
    ? [createNextAction("pools", "Return to pool discovery after reviewing this activity page.", "after_activity", {
        options: { chain: data.chain },
      })]
    : [createNextAction("accounts", "Inspect current Pool Account balances after reviewing public activity.", "after_activity", {
        options: data.chain !== "all-mainnets" ? { chain: data.chain } : undefined,
      })];
  const agentNextActions = hasNextPage
    ? [createNextAction("activity", "View the next page.", "after_activity", {
        options: { agent: true, ...paginationOptions },
      })]
    : fallbackAgentNextActions;
  const humanNextActions = hasNextPage
    ? [createNextAction("activity", "View the next page.", "after_activity", {
        options: paginationOptions,
      })]
    : fallbackHumanNextActions;

  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      mode: data.mode,
      chain: data.chain,
      ...(data.chains ? { chains: data.chains } : {}),
      page: data.page,
      perPage: data.perPage,
      total: data.total,
      totalEvents: data.total,
      totalPages: data.totalPages,
      events: data.events.map((e) => ({
        type: e.type,
        txHash: e.txHash,
        explorerUrl: e.txHash && e.chainId !== null ? explorerTxUrl(e.chainId, e.txHash) : null,
        reviewStatus: formatActivityStatusPlain(e.type, e.reviewStatus),
        amountRaw: e.amountRaw,
        amountFormatted: e.amountFormatted,
        poolSymbol: e.poolSymbol,
        poolAddress: e.poolAddress,
        chainId: e.chainId,
        timestamp: toIsoTimestamp(e.timestampMs),
      })),
    };
    if (data.mode === "pool-activity") {
      payload.asset = data.asset;
      payload.pool = data.pool;
      payload.scope = data.scope;
    }
    if (data.chainFiltered) {
      payload.chainFiltered = true;
    }
    if (data.note) {
      payload.note = data.note;
    } else if (data.chainFiltered) {
      payload.note = "Pagination totals are unavailable when filtering by chain. Results may be sparse.";
    }
    printJsonSuccess(appendNextActions(payload, agentNextActions), false);
    return;
  }

  if (ctx.mode.isCsv) {
    printCsv(
      ["Type", "Pool", "Amount", "Status", "Time", "Tx"],
      data.events.map((e) => [
        renderActivityType(e.type),
        eventPoolLabel(e),
        e.amountFormatted,
        formatActivityStatusPlain(e.type, e.reviewStatus),
        e.timeLabel,
        e.txHash ? formatAddress(e.txHash, 8) : "-",
      ]),
    );
    return;
  }

  if (ctx.mode.isName) {
    const lines = data.events
      .map((event) => event.txHash)
      .filter((txHash): txHash is string => typeof txHash === "string" && txHash.length > 0);
    if (lines.length > 0) {
      process.stdout.write(`${lines.join("\n")}\n`);
    }
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

  process.stderr.write(formatSectionHeading("Summary", { divider: true }));
  process.stderr.write(
    formatKeyValueRows([
      { label: "Mode", value: data.mode },
      { label: "Chain", value: chainLabel },
      { label: "Page", value: String(data.page) },
      { label: "Results", value: String(data.events.length) },
      ...(data.total !== null ? [{ label: "Total events", value: String(data.total) }] : []),
    ]),
  );

  if (data.events.length === 0) {
    const emptyMessage = data.mode === "pool-activity"
      ? `No activity found for ${data.asset} on ${data.chain}.`
      : `No activity found on ${chainLabel}.`;
    process.stderr.write(`${emptyMessage}\n`);
    if (data.page > 1) {
      process.stderr.write("You may have reached the end of the available results.\n");
    }
    renderNextSteps(ctx, humanNextActions);
    return;
  }

  const renderTableLayout = ctx.mode.isWide || getOutputWidthClass() === "wide";
  if (!renderTableLayout) {
    for (const event of data.events) {
      process.stderr.write(
        formatSectionHeading(`${renderActivityType(event.type)} ${event.amountFormatted}`, {
          divider: true,
        }),
      );
      process.stderr.write(
        formatStackedKeyValueRows([
          { label: "Pool", value: eventPoolLabel(event) },
          {
            label: "Status",
            value: formatActivityStatusPlain(event.type, event.reviewStatus),
          },
          { label: "Time", value: event.timeLabel },
          { label: "Tx", value: event.txHash ? formatAddress(event.txHash, 8) : "-" },
        ]),
      );
    }
    if (data.note) {
      process.stderr.write(
        formatCallout(
          "read-only",
          data.note,
        ),
      );
    } else if (data.chainFiltered) {
      process.stderr.write(
        formatCallout(
          "read-only",
          `Results are filtered to ${data.chain}. Some pages may be sparse.`,
        ),
      );
    }
    renderNextSteps(ctx, humanNextActions);
    return;
  }

  const isWideFormat = ctx.mode.isWide;
  const activityHeaders = isWideFormat
    ? ["Type", "Pool", "Amount", "Status", "Time", "Tx", "Pool Address", "Chain"]
    : ["Type", "Pool", "Amount", "Status", "Time", "Tx"];
  printTable(
    activityHeaders,
      data.events.map((e) => {
        const row = [
          renderActivityType(e.type),
          eventPoolLabel(e),
          e.amountFormatted,
          renderActivityStatus(e.type, e.reviewStatus),
          e.timeLabel,
          e.txHash ? formatAddress(e.txHash, 8) : "-",
        ];
        if (isWideFormat) {
          row.push(
            e.poolAddress ? formatAddress(e.poolAddress, 8) : "-",
            e.chainId !== null ? String(e.chainId) : "-",
          );
        }
        return row;
      }),
  );

  // Pagination footer
  if (data.totalPages !== null && data.totalPages > 1) {
    process.stderr.write(
      `\n  ${muted(`Page ${data.page} of ${data.totalPages}`)}` +
        (data.total !== null ? muted(`${inlineSeparator()}${data.total} events`) : "") +
        (data.page < data.totalPages
          ? `\n  ${muted(`privacy-pools activity --page ${data.page + 1}`)}`
          : "") +
        "\n",
    );
  }

  if (data.note) {
    process.stderr.write(
      formatCallout(
        "read-only",
        data.note,
      ),
    );
  } else if (data.chainFiltered) {
    process.stderr.write(
      formatCallout(
        "read-only",
        `Results are filtered to ${data.chain}. Some pages may be sparse.`,
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
