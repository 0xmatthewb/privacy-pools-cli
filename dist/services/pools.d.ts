import type { Address, PublicClient } from "viem";
import type { ChainConfig, PoolStats } from "../types.js";
export declare function resolveTokenMetadata(publicClient: PublicClient, assetAddress: Address): Promise<{
    symbol: string;
    decimals: number;
}>;
export declare function listPools(chainConfig: ChainConfig, rpcOverride?: string): Promise<PoolStats[]>;
export declare function resolvePool(chainConfig: ChainConfig, assetInput: string, rpcOverride?: string): Promise<PoolStats>;
