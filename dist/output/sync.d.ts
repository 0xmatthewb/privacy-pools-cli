/**
 * Output renderer for the `sync` command.
 *
 * Phase 1 stub – delegates to existing output calls.
 * Phase 2 will move inline output from src/commands/sync.ts here.
 */
import type { OutputContext } from "./common.js";
export interface SyncResult {
    chain: string;
    syncedPools: number;
    syncedSymbols?: string[];
    spendableCommitments: number;
}
/**
 * Render "no pools found" output.
 */
export declare function renderSyncEmpty(ctx: OutputContext, chain: string): void;
/**
 * Render successful sync output.
 */
export declare function renderSyncComplete(ctx: OutputContext, result: SyncResult): void;
