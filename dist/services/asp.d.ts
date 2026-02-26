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
export declare function checkLiveness(chainConfig: ChainConfig): Promise<boolean>;
