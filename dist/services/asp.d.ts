import type { ChainConfig, MtRootsResponse, MtLeavesResponse } from "../types.js";
export declare function fetchMerkleRoots(chainConfig: ChainConfig, scope: bigint): Promise<MtRootsResponse>;
export declare function fetchMerkleLeaves(chainConfig: ChainConfig, scope: bigint): Promise<MtLeavesResponse>;
export interface PoolStatsEntry {
    scope: string;
    tokenAddress?: string;
    assetAddress?: string;
    tokenSymbol?: string;
    [key: string]: unknown;
}
export declare function fetchPoolsStats(chainConfig: ChainConfig): Promise<PoolStatsEntry[] | {
    pools?: PoolStatsEntry[];
}>;
export declare function fetchDepositsLargerThan(chainConfig: ChainConfig, scope: bigint, amount: bigint): Promise<{
    eligibleDeposits: number;
    totalDeposits: number;
    percentage: number;
}>;
/**
 * Fetch ASP leaves and return a Set of approved labels for a pool.
 * Returns null if the ASP is unreachable (non-fatal).
 */
export declare function fetchApprovedLabels(chainConfig: ChainConfig, scope: bigint): Promise<Set<string> | null>;
export declare function checkLiveness(chainConfig: ChainConfig): Promise<boolean>;
