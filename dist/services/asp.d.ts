import type { ChainConfig, MtRootsResponse, MtLeavesResponse } from "../types.js";
export declare function fetchMerkleRoots(chainConfig: ChainConfig, scope: bigint): Promise<MtRootsResponse>;
export declare function fetchMerkleLeaves(chainConfig: ChainConfig, scope: bigint): Promise<MtLeavesResponse>;
export declare function fetchPoolsStats(chainConfig: ChainConfig): Promise<any[]>;
export declare function checkLiveness(chainConfig: ChainConfig): Promise<boolean>;
