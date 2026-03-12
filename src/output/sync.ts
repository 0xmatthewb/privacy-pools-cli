/**
 * Output renderer for the `sync` command.
 *
 * `src/commands/sync.ts` delegates output rendering here.
 * Spinners and verbose logging remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  renderNextSteps,
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

  const agentNextActions = result.availablePoolAccounts > 0
    ? [createNextAction("accounts", "View your synced Pool Accounts and balances.", "after_sync",
        { options: { agent: true, chain: result.chain } })]
    : [createNextAction("pools", "Browse available pools to deposit into.", "after_sync_empty",
        { options: { agent: true, chain: result.chain } })];

  // Human: no --chain (uses default set during init).
  const humanNextActions = result.availablePoolAccounts > 0
    ? [createNextAction("accounts", "View your synced Pool Accounts and balances.", "after_sync")]
    : [createNextAction("pools", "Browse available pools to deposit into.", "after_sync_empty")];

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

  info(`Available Pool Accounts: ${result.availablePoolAccounts}`, silent);
  renderNextSteps(ctx, humanNextActions);
}
