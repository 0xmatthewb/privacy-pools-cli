/**
 * Output renderer for the `pools` command.
 *
 * `src/commands/pools.ts` delegates final output here.
 * Pool fetching, search, sort, and spinner remain in the command handler.
 */
import type { OutputContext } from "./common.js";
import type { PoolStats } from "../types.js";
export interface PoolWithChain {
    chain: string;
    chainId: number;
    pool: PoolStats;
}
export interface ChainSummary {
    chain: string;
    pools: number;
    error: string | null;
}
export interface PoolWarning {
    chain: string;
    category: string;
    message: string;
}
export interface PoolsRenderData {
    allChains: boolean;
    chainName: string;
    search: string | null;
    sort: string;
    filteredPools: PoolWithChain[];
    chainSummaries?: ChainSummary[];
    warnings: PoolWarning[];
}
export declare function poolToJson(pool: PoolStats, chain?: string): Record<string, string | number | null>;
/**
 * Render "no pools found" (all raw pools empty, no errors to throw).
 */
export declare function renderPoolsEmpty(ctx: OutputContext, data: PoolsRenderData): void;
/**
 * Render populated pools listing.
 */
export declare function renderPools(ctx: OutputContext, data: PoolsRenderData): void;
