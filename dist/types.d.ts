import type { Address, Hex } from "viem";
import type { Chain } from "viem/chains";
export interface ChainConfig {
    id: number;
    name: string;
    chain: Chain;
    entrypoint: Address;
    startBlock: bigint;
    aspHost: string;
    relayerHost: string;
    isTestnet: boolean;
}
export interface CLIConfig {
    defaultChain: string;
    rpcOverrides: Record<number, string>;
    signerKeyPath?: string;
}
export interface GlobalOptions {
    chain?: string;
    rpcUrl?: string;
    json?: boolean;
    agent?: boolean;
    quiet?: boolean;
    yes?: boolean;
    verbose?: boolean;
}
export interface PoolStats {
    asset: Address;
    pool: Address;
    scope: bigint;
    symbol: string;
    decimals: number;
    minimumDepositAmount: bigint;
    vettingFeeBPS: bigint;
    maxRelayFeeBPS: bigint;
}
export interface MtRootsResponse {
    mtRoot: string;
    createdAt: string;
    onchainMtRoot: string;
}
export interface MtLeavesResponse {
    aspLeaves: string[];
    stateTreeLeaves: string[];
}
export interface RelayerDetailsResponse {
    chainId: number;
    feeBPS: string;
    minWithdrawAmount: string;
    feeReceiverAddress: Address;
    assetAddress: Address;
    maxGasPrice: string;
}
export interface RelayerQuoteResponse {
    baseFeeBPS: string;
    feeBPS: string;
    gasPrice: string;
    detail: {
        relayTxCost: {
            gas: string;
            eth: string;
        };
    };
    feeCommitment?: {
        expiration: number;
        withdrawalData: Hex;
        asset: Address;
        amount: string;
        extraGas: boolean;
        signedRelayerCommitment: Hex;
    };
}
export interface RelayerRequestResponse {
    success: boolean;
    txHash: Hex;
    timestamp: number;
    requestId: string;
}
export interface SerializedAccount {
    masterKeys: [string, string];
    poolAccounts: Array<[string, unknown[]]>;
    creationTimestamp?: string;
    lastUpdateTimestamp?: string;
}
