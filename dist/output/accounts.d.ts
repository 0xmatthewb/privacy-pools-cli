/**
 * Output renderer for the `accounts` command.
 *
 * `src/commands/accounts.ts` delegates final output here.
 * Sync, pool discovery, ASP label fetching, and spinner remain in
 * the command handler.
 */
import type { OutputContext } from "./common.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
export interface AccountPoolGroup {
    symbol: string;
    poolAddress: string;
    decimals: number;
    scope: bigint;
    poolAccounts: PoolAccountRef[];
}
export interface AccountsRenderData {
    chain: string;
    groups: AccountPoolGroup[];
    showDetails: boolean;
    showAll: boolean;
}
/**
 * Render "no pools found" for accounts.
 */
export declare function renderAccountsNoPools(ctx: OutputContext, chain: string): void;
/**
 * Render populated accounts listing.
 */
export declare function renderAccounts(ctx: OutputContext, data: AccountsRenderData): void;
