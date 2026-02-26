import type { ChainConfig } from "../types.js";
export declare function resolveChain(chainName?: string, defaultChain?: string): ChainConfig;
export declare function validateAddress(value: string, label?: string): `0x${string}`;
export declare function parseAmount(value: string, decimals: number): bigint;
export declare function validatePositive(value: bigint, label?: string): void;
