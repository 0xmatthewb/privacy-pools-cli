/**
 * Output renderer for the `sync` command.
 *
 * `src/commands/sync.ts` delegates output rendering here.
 * Spinners and verbose logging remain in the command handler.
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
