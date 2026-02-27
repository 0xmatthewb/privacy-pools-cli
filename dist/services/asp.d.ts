import type { ChainConfig, MtRootsResponse, MtLeavesResponse, AspEventsPageResponse, PoolStatisticsResponse, GlobalStatisticsResponse } from "../types.js";
export declare function fetchMerkleRoots(chainConfig: ChainConfig, scope: bigint): Promise<MtRootsResponse>;
export declare function fetchMerkleLeaves(chainConfig: ChainConfig, scope: bigint): Promise<MtLeavesResponse>;
export declare function fetchPoolEvents(chainConfig: ChainConfig, scope: bigint, page: number, perPage: number): Promise<AspEventsPageResponse>;
export declare function fetchGlobalEvents(chainConfig: ChainConfig, page: number, perPage: number): Promise<AspEventsPageResponse>;
export interface PoolStatsEntry {
    scope: string;
    chainId?: number;
    totalInPoolValue?: string;
    totalInPoolValueUsd?: string;
    totalDepositsValue?: string;
    totalDepositsValueUsd?: string;
    acceptedDepositsValue?: string;
    acceptedDepositsValueUsd?: string;
    totalDepositsCount?: number;
    acceptedDepositsCount?: number;
    pendingDepositsValue?: string;
    pendingDepositsValueUsd?: string;
    pendingDepositsCount?: number;
    growth24h?: number | null;
    pendingGrowth24h?: number | null;
    tokenAddress?: string;
    assetAddress?: string;
    tokenSymbol?: string;
    [key: string]: unknown;
}
export declare function fetchPoolsStats(chainConfig: ChainConfig): Promise<PoolStatsEntry[] | {
    pools?: PoolStatsEntry[];
    [scope: string]: PoolStatsEntry | PoolStatsEntry[] | undefined;
}>;
export declare function fetchDepositsLargerThan(chainConfig: ChainConfig, scope: bigint, amount: bigint): Promise<{
    eligibleDeposits: number;
    totalDeposits: number;
    percentage: number;
}>;
export declare function fetchPoolStatistics(chainConfig: ChainConfig, scope: bigint): Promise<PoolStatisticsResponse>;
export declare function fetchGlobalStatistics(chainConfig: ChainConfig): Promise<GlobalStatisticsResponse>;
/**
 * Fetch ASP leaves and return a Set of approved labels for a pool.
 * Returns null if the ASP is unreachable (non-fatal).
 */
export declare function fetchApprovedLabels(chainConfig: ChainConfig, scope: bigint): Promise<Set<string> | null>;
export declare function checkLiveness(chainConfig: ChainConfig): Promise<boolean>;
