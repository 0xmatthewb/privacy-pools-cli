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
} from "./common.js";

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

  if (ctx.mode.isJson) {
    printJsonSuccess(
      {
        chain: result.chain,
        syncedPools: result.syncedPools,
        syncedSymbols: result.syncedSymbols,
        availablePoolAccounts: result.availablePoolAccounts,
        previousAvailablePoolAccounts: result.previousAvailablePoolAccounts,
      },
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

  info(`Available Pool Accounts: ${result.availablePoolAccounts}`, silent);
}
