/**
 * Output renderer for the `balance` command.
 *
 * Phase 3 – src/commands/balance.ts delegates all final output here.
 * Sync, pool discovery, and spinner remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printTable, isSilent } from "./common.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceRow {
  symbol: string;
  formattedBalance: string;
  commitments: number;
}

export interface BalanceJsonEntry {
  asset: string;
  assetAddress: string;
  balance: string;
  commitments: number;
  poolAccounts: number;
}

export interface BalanceRenderData {
  chain: string;
  rows: BalanceRow[];
  jsonData: BalanceJsonEntry[];
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * Render "no pools found" for balance.
 */
export function renderBalanceNoPools(ctx: OutputContext, chain: string): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({ chain, balances: [] });
    return;
  }
  process.stderr.write(`No pools found on ${chain}.\n`);
}

/**
 * Render "no balances found" (pools exist but no spendable commitments).
 */
export function renderBalanceEmpty(ctx: OutputContext, chain: string): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({ chain, balances: [] }, false);
    return;
  }
  process.stderr.write(`\nNo balances found on ${chain}. Deposit first to create Pool Accounts.\n`);
}

/**
 * Render populated balance table.
 */
export function renderBalance(ctx: OutputContext, data: BalanceRenderData): void {
  if (ctx.mode.isJson) {
    printJsonSuccess(
      { chain: data.chain, balances: data.jsonData },
      false,
    );
    return;
  }

  process.stderr.write(`\nBalances on ${data.chain}:\n\n`);
  printTable(
    ["Asset", "Balance", "Pool Accounts"],
    data.rows.map((r) => [r.symbol, r.formattedBalance, r.commitments.toString()]),
  );
}
