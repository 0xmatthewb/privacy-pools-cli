import { AccountService, DataService, type PoolInfo } from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
import type { ChainConfig } from "../types.js";
export declare function accountExists(chainId: number): boolean;
export declare function loadAccount(chainId: number): any | null;
export declare function saveAccount(chainId: number, account: any): void;
/**
 * Cast raw pool data to SDK PoolInfo (handles branded Hash type for scope)
 */
export declare function toPoolInfo(pool: {
    chainId: number;
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
}): PoolInfo;
export declare function syncAccount(chainConfig: ChainConfig, accountService: AccountService, pools: Array<{
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
}>): Promise<void>;
export declare function initializeAccountService(dataService: DataService, mnemonic: string, pools: Array<{
    chainId: number;
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
}>, chainId: number, 
/** When true, sync events even for saved accounts to catch external changes */
forceSync?: boolean, 
/** When true, suppress best-effort sync warnings to keep machine stderr clean */
suppressWarnings?: boolean, 
/** When true, treat sync/initialization failures as hard errors (fail-closed). */
strictSync?: boolean): Promise<AccountService>;
