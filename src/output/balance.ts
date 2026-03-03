/**
 * Output renderer for the `balance` command.
 *
 * `src/commands/balance.ts` delegates final output here.
 * Sync, pool discovery, and spinner remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, printTable, info, isSilent } from "./common.js";
import { accentBold } from "../utils/theme.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BalanceRow {
  symbol: string;
  formattedBalance: string;
  usdValue: string;
  commitments: number;
}

export interface BalanceJsonEntry {
  asset: string;
  assetAddress: string;
  balance: string;
  usdValue: string | null;
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
  info(`No pools found on ${chain}.`, isSilent(ctx));
}

/**
 * Render "no balances found" (pools exist but no spendable commitments).
 */
export function renderBalanceEmpty(ctx: OutputContext, chain: string): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({ chain, balances: [] }, false);
    return;
  }
  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  info(`No balances found on ${chain}. Deposit first to create Pool Accounts.`, silent);
  info(
    "Note: recent deposits may not appear until approved by the ASP.",
    silent,
  );
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

  const silent = isSilent(ctx);
  if (silent) return;

  process.stderr.write(`\n${accentBold(`Balances on ${data.chain}:`)}\n\n`);
  const hasUsd = data.rows.some((r) => r.usdValue !== "-");
  printTable(
    hasUsd ? ["Asset", "Balance", "USD Value", "Pool Accounts"] : ["Asset", "Balance", "Pool Accounts"],
    data.rows.map((r) =>
      hasUsd
        ? [r.symbol, r.formattedBalance, r.usdValue, r.commitments.toString()]
        : [r.symbol, r.formattedBalance, r.commitments.toString()],
    ),
  );
  process.stderr.write("\n");
  info(
    "Note: only approved deposits are shown. Recent deposits may be pending ASP approval.",
    silent,
  );
}
