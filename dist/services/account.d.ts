import { AccountService, DataService, type PoolInfo } from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
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
/**
 * The SDK emits info logs with console.log in some account paths.
 * Suppress stdout temporarily so machine-mode JSON contracts remain parseable.
 */
export declare function withSuppressedSdkStdout<T>(fn: () => Promise<T>): Promise<T>;
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
