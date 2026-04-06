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

  info(`No pools found on ${chain}.`, isSilent(ctx));
}

/**
 * Render successful sync output.
 */
export function renderSyncComplete(
  ctx: OutputContext,
  result: SyncResult,
): void {
  guardCsvUnsupported(ctx, "sync");

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
          availablePoolAccounts: result.availablePoolAccounts,
          previousAvailablePoolAccounts: result.previousAvailablePoolAccounts,
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

  const delta = result.availablePoolAccounts - (result.previousAvailablePoolAccounts ?? result.availablePoolAccounts);
  if (delta > 0) {
    success(`Found ${delta} new Pool Account(s).`, silent);
  }
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: result.chain },
        { label: "Synced pools", value: String(result.syncedPools) },
        { label: "Available Pool Accounts", value: String(result.availablePoolAccounts) },
        ...(result.previousAvailablePoolAccounts !== undefined
          ? [{ label: "Previous available", value: String(result.previousAvailablePoolAccounts) }]
          : []),
        ...(delta > 0
          ? [{ label: "New Pool Accounts", value: String(delta), valueTone: "success" as const }]
          : []),
      ]),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
