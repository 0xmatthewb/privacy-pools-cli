/**
 * Output renderer for the `balance` command.
 *
 * Phase 3 – src/commands/balance.ts delegates all final output here.
 * Sync, pool discovery, and spinner remain in the command handler.
 */
import { printJsonSuccess, printTable } from "./common.js";
// ── Renderers ────────────────────────────────────────────────────────────────
/**
 * Render "no pools found" for balance.
 */
export function renderBalanceNoPools(ctx, chain) {
    if (ctx.mode.isJson) {
        printJsonSuccess({ chain, balances: [] });
        return;
    }
    process.stderr.write(`No pools found on ${chain}.\n`);
}
/**
 * Render "no balances found" (pools exist but no spendable commitments).
 */
export function renderBalanceEmpty(ctx, chain) {
    if (ctx.mode.isJson) {
        printJsonSuccess({ chain, balances: [] }, false);
        return;
    }
    process.stderr.write(`\nNo balances found on ${chain}. Deposit first to create Pool Accounts.\n`);
}
/**
 * Render populated balance table.
 */
export function renderBalance(ctx, data) {
    if (ctx.mode.isJson) {
        printJsonSuccess({ chain: data.chain, balances: data.jsonData }, false);
        return;
    }
    process.stderr.write(`\nBalances on ${data.chain}:\n\n`);
    printTable(["Asset", "Balance", "Pool Accounts"], data.rows.map((r) => [r.symbol, r.formattedBalance, r.commitments.toString()]));
}
