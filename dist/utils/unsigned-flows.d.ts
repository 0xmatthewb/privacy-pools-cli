import type { Address, Hex } from "viem";
import type { SolidityProof, UnsignedTransactionPayload } from "./unsigned.js";
export declare const erc20ApproveAbi: readonly [{
    readonly name: "approve";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "spender";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}];
export declare const entrypointDepositNativeAbi: readonly [{
    readonly name: "deposit";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "_precommitment";
    }];
    readonly outputs: readonly [];
}];
export declare const entrypointDepositErc20Abi: readonly [{
    readonly name: "deposit";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "_asset";
    }, {
        readonly type: "uint256";
        readonly name: "_value";
    }, {
        readonly type: "uint256";
        readonly name: "_precommitment";
    }];
    readonly outputs: readonly [];
}];
export declare const privacyPoolWithdrawAbi: readonly [{
    readonly name: "withdraw";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "processooor";
        }, {
            readonly type: "bytes";
            readonly name: "data";
        }];
        readonly name: "_withdrawal";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "uint256[2]";
            readonly name: "pA";
        }, {
            readonly type: "uint256[2][2]";
            readonly name: "pB";
        }, {
            readonly type: "uint256[2]";
            readonly name: "pC";
        }, {
            readonly type: "uint256[8]";
            readonly name: "pubSignals";
        }];
        readonly name: "_proof";
    }];
    readonly outputs: readonly [];
}];
export declare const entrypointRelayAbi: readonly [{
    readonly name: "relay";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "processooor";
        }, {
            readonly type: "bytes";
            readonly name: "data";
        }];
        readonly name: "_withdrawal";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "uint256[2]";
            readonly name: "pA";
        }, {
            readonly type: "uint256[2][2]";
            readonly name: "pB";
        }, {
            readonly type: "uint256[2]";
            readonly name: "pC";
        }, {
            readonly type: "uint256[8]";
            readonly name: "pubSignals";
        }];
        readonly name: "_proof";
    }, {
        readonly type: "uint256";
        readonly name: "_scope";
    }];
    readonly outputs: readonly [];
}];
export declare const privacyPoolRagequitAbi: readonly [{
    readonly name: "ragequit";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "uint256[2]";
            readonly name: "pA";
        }, {
            readonly type: "uint256[2][2]";
            readonly name: "pB";
        }, {
            readonly type: "uint256[2]";
            readonly name: "pC";
        }, {
            readonly type: "uint256[4]";
            readonly name: "pubSignals";
        }];
        readonly name: "_proof";
    }];
    readonly outputs: readonly [];
}];
interface WithdrawalCall {
    processooor: Address;
    data: Hex;
}
interface UnsignedBase {
    chainId: number;
    chainName: string;
    assetSymbol: string;
    amount: bigint;
    from: Address | null;
}
export interface UnsignedDepositOutput {
    mode: "unsigned";
    operation: "deposit";
    chain: string;
    asset: string;
    amount: string;
    precommitment: string;
    transactions: UnsignedTransactionPayload[];
}
export declare function buildUnsignedDepositOutput(params: UnsignedBase & {
    entrypoint: Address;
    assetAddress: Address;
    precommitment: bigint;
    isNative: boolean;
}): UnsignedDepositOutput;
export interface UnsignedDirectWithdrawOutput {
    mode: "unsigned";
    operation: "withdraw";
    withdrawMode: "direct";
    chain: string;
    asset: string;
    amount: string;
    recipient: Address;
    selectedCommitmentLabel: string;
    selectedCommitmentValue: string;
    transactions: UnsignedTransactionPayload[];
}
export declare function buildUnsignedDirectWithdrawOutput(params: UnsignedBase & {
    poolAddress: Address;
    recipient: Address;
    selectedCommitmentLabel: bigint;
    selectedCommitmentValue: bigint;
    withdrawal: WithdrawalCall;
    proof: SolidityProof;
}): UnsignedDirectWithdrawOutput;
export interface UnsignedRelayedWithdrawOutput {
    mode: "unsigned";
    operation: "withdraw";
    withdrawMode: "relayed";
    chain: string;
    asset: string;
    amount: string;
    recipient: Address;
    selectedCommitmentLabel: string;
    selectedCommitmentValue: string;
    feeBPS: string;
    quoteExpiresAt: string;
    transactions: UnsignedTransactionPayload[];
    relayerRequest: unknown;
}
export declare function buildUnsignedRelayedWithdrawOutput(params: UnsignedBase & {
    entrypoint: Address;
    scope: bigint;
    recipient: Address;
    selectedCommitmentLabel: bigint;
    selectedCommitmentValue: bigint;
    feeBPS: string;
    quoteExpiresAt: string;
    withdrawal: WithdrawalCall;
    proof: SolidityProof;
    relayerRequest: unknown;
}): UnsignedRelayedWithdrawOutput;
export interface UnsignedRagequitOutput {
    mode: "unsigned";
    operation: "ragequit";
    chain: string;
    asset: string;
    amount: string;
    selectedCommitmentLabel: string;
    selectedCommitmentValue: string;
    transactions: UnsignedTransactionPayload[];
}
export declare function buildUnsignedRagequitOutput(params: UnsignedBase & {
    poolAddress: Address;
    selectedCommitmentLabel: bigint;
    selectedCommitmentValue: bigint;
    proof: SolidityProof;
}): UnsignedRagequitOutput;
export {};
