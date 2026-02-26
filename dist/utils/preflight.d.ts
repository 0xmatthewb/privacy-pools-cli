import type { Address, PublicClient } from "viem";
export declare function checkNativeBalance(publicClient: PublicClient, signerAddress: Address, requiredWei: bigint, symbol: string): Promise<void>;
export declare function checkErc20Balance(publicClient: PublicClient, tokenAddress: Address, signerAddress: Address, requiredAmount: bigint, decimals: number, symbol: string): Promise<void>;
/**
 * Lightweight gas check - verifies the signer has *some* native balance for gas.
 * Does not estimate exact gas cost (that would require a simulation call).
 */
export declare function checkHasGas(publicClient: PublicClient, signerAddress: Address, symbol?: string): Promise<void>;
