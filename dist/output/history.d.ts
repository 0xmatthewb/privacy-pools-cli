/**
 * Output renderer for the `history` command.
 *
 * Phase 3 – src/commands/history.ts delegates all final output here.
 * Event extraction (buildHistoryEventsFromAccount), sync, pool discovery,
 * and spinner remain in the command handler.
 */
import type { OutputContext } from "./common.js";
import type { HistoryEvent } from "../commands/history.js";
export interface HistoryPoolInfo {
    pool: string;
    decimals: number;
}
export interface HistoryRenderData {
    chain: string;
    chainId: number;
    events: HistoryEvent[];
    poolByAddress: Map<string, HistoryPoolInfo>;
    explorerTxUrl: (chainId: number, txHash: string) => string | null;
}
/**
 * Render "no pools found" for history.
 */
export declare function renderHistoryNoPools(ctx: OutputContext, chain: string): void;
/**
 * Render history event listing.
 */
export declare function renderHistory(ctx: OutputContext, data: HistoryRenderData): void;
