/**
 * Output renderer for the `sync` command.
 *
 * `src/commands/sync.ts` delegates output rendering here.
 * Spinners and verbose logging remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, info, success, isSilent } from "./common.js";

export interface SyncResult {
  chain: string;
  syncedPools: number;
  syncedSymbols?: string[];
  spendableCommitments: number;
}

/**
 * Render "no pools found" output.
 */
export function renderSyncEmpty(ctx: OutputContext, chain: string): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({
      chain,
      syncedPools: 0,
      spendableCommitments: 0,
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
  if (ctx.mode.isJson) {
    printJsonSuccess({
      chain: result.chain,
      syncedPools: result.syncedPools,
      syncedSymbols: result.syncedSymbols,
      spendableCommitments: result.spendableCommitments,
    });
    return;
  }

  const silent = isSilent(ctx);
  success(
    `Synced ${result.syncedPools} pool(s) on ${result.chain}.`,
    silent,
  );
  info(`Available Pool Accounts: ${result.spendableCommitments}`, silent);
}
