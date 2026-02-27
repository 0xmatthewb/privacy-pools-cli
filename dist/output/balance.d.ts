/**
 * Output renderer for the `balance` command.
 *
 * Phase 3 – src/commands/balance.ts delegates all final output here.
 * Sync, pool discovery, and spinner remain in the command handler.
 */
import type { OutputContext } from "./common.js";
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
/**
 * Render "no pools found" for balance.
 */
export declare function renderBalanceNoPools(ctx: OutputContext, chain: string): void;
/**
 * Render "no balances found" (pools exist but no spendable commitments).
 */
export declare function renderBalanceEmpty(ctx: OutputContext, chain: string): void;
/**
 * Render populated balance table.
 */
export declare function renderBalance(ctx: OutputContext, data: BalanceRenderData): void;
