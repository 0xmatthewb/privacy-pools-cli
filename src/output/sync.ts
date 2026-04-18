/**
 * Output renderer for the `sync` command.
 *
 * `src/commands/sync.ts` delegates output rendering here.
 * Spinners and verbose logging remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import {
  printJsonSuccess,
  info,
  success,
  isSilent,
  guardCsvUnsupported,
  createNextAction,
  appendNextActions,
  renderNextSteps,
} from "./common.js";
import { formatKeyValueRows, formatSectionHeading } from "./layout.js";

export interface SyncResult {
  chain: string;
  syncedPools: number;
  syncedSymbols?: string[];
  availablePoolAccounts: number;
  previousAvailablePoolAccounts?: number;
  /** True when the user explicitly passed --chain (overriding the default). */
  chainOverridden?: boolean;
  durationMs?: number;
  scannedFromBlock?: bigint;
  scannedToBlock?: bigint | null;
  eventCounts?: {
    deposits: number;
    withdrawals: number;
    ragequits: number;
    migrations: number;
    total: number;
  };
  lastSyncTime?: number | null;
}

/**
 * Render "no pools found" output.
 */
export function renderSyncEmpty(ctx: OutputContext, chain: string): void {
  guardCsvUnsupported(ctx, "sync");

  if (ctx.mode.isJson) {
    printJsonSuccess({
      chain,
      syncedPools: 0,
      availablePoolAccounts: 0,
    });
    return;
  }

  info(`No synced Pool Accounts are available on ${chain} yet.`, isSilent(ctx));
}

/**
 * Render successful sync output.
 */
export function renderSyncComplete(
  ctx: OutputContext,
  result: SyncResult,
): void {
  guardCsvUnsupported(ctx, "sync");
  const availablePoolAccounts = Number.isFinite(result.availablePoolAccounts)
    ? result.availablePoolAccounts
    : 0;
  const previousAvailablePoolAccounts =
    typeof result.previousAvailablePoolAccounts === "number" &&
      Number.isFinite(result.previousAvailablePoolAccounts)
      ? result.previousAvailablePoolAccounts
      : undefined;

  const agentNextActions = [
    createNextAction("accounts", "Review synced Pool Accounts.", "after_sync", {
      options: { agent: true, chain: result.chain },
    }),
  ];
  const humanNextActions = [
    createNextAction("accounts", "Review synced Pool Accounts.", "after_sync", {
      options: { chain: result.chain },
    }),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions(
        {
          chain: result.chain,
          syncedPools: result.syncedPools,
          syncedSymbols: result.syncedSymbols,
          availablePoolAccounts,
          previousAvailablePoolAccounts,
          ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
          ...(result.scannedFromBlock !== undefined
            ? { scannedFromBlock: result.scannedFromBlock.toString() }
            : {}),
          ...(result.scannedToBlock !== undefined
            ? {
                scannedToBlock:
                  result.scannedToBlock === null
                    ? null
                    : result.scannedToBlock.toString(),
              }
            : {}),
          ...(result.eventCounts ? { eventCounts: result.eventCounts } : {}),
          ...(result.lastSyncTime != null
            ? { lastSyncTime: new Date(result.lastSyncTime).toISOString() }
            : {}),
        },
        agentNextActions,
      ),
    );
    return;
  }

  const silent = isSilent(ctx);
  success(
    `Synced ${result.syncedPools} pool(s) on ${result.chain}.`,
    silent,
  );

  const delta = availablePoolAccounts - (previousAvailablePoolAccounts ?? availablePoolAccounts);
  if (delta > 0) {
    success(`Found ${delta} new Pool Account(s).`, silent);
  }
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: result.chain },
        { label: "Synced pools", value: String(result.syncedPools) },
        { label: "Available Pool Accounts", value: String(availablePoolAccounts) },
        ...(result.durationMs !== undefined
          ? [{ label: "Duration", value: `${(result.durationMs / 1000).toFixed(1)}s` }]
          : []),
        ...(result.scannedFromBlock !== undefined
          ? [{ label: "Scanned from", value: result.scannedFromBlock.toString() }]
          : []),
        ...(result.scannedToBlock !== undefined
          ? [{
              label: "Scanned to",
              value: result.scannedToBlock === null ? "unavailable" : result.scannedToBlock.toString(),
            }]
          : []),
        ...(previousAvailablePoolAccounts !== undefined
          ? [{ label: "Previous available", value: String(previousAvailablePoolAccounts) }]
          : []),
        ...(delta > 0
          ? [{ label: "New Pool Accounts", value: String(delta), valueTone: "success" as const }]
          : []),
        ...(result.eventCounts
          ? [
              { label: "Deposits seen", value: String(result.eventCounts.deposits) },
              { label: "Withdrawals seen", value: String(result.eventCounts.withdrawals) },
              { label: "Ragequits seen", value: String(result.eventCounts.ragequits) },
              { label: "Migrations seen", value: String(result.eventCounts.migrations) },
            ]
          : []),
        ...(result.lastSyncTime != null
          ? [{ label: "Last sync", value: new Date(result.lastSyncTime).toISOString() }]
          : []),
      ]),
    );
    process.stderr.write(
      "If sync is interrupted, re-run sync to reconcile the local cache before relying on it.\n",
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
