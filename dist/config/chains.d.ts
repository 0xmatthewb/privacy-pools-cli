import type { ChainConfig } from "../types.js";
export declare const CHAINS: Record<string, ChainConfig>;
export declare const CHAIN_NAMES: string[];
export declare const NATIVE_ASSET_ADDRESS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export declare function explorerTxUrl(chainId: number, txHash: string): string | null;
