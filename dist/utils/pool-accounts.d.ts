import type { AccountCommitment, PrivacyPoolAccount } from "@0xbow/privacy-pools-core-sdk";
export type PoolAccountStatus = "spendable" | "spent" | "exited";
export interface PoolAccountRef {
    paNumber: number;
    paId: string;
    status: PoolAccountStatus;
    commitment: AccountCommitment;
    label: bigint;
    value: bigint;
    blockNumber: bigint;
    txHash: string;
}
export declare function poolAccountId(paNumber: number): string;
export declare function parsePoolAccountSelector(value: string): number | null;
export declare function buildPoolAccountRefs(account: PrivacyPoolAccount | null | undefined, scope: bigint, spendableCommitments: readonly AccountCommitment[]): PoolAccountRef[];
export declare function buildAllPoolAccountRefs(account: PrivacyPoolAccount | null | undefined, scope: bigint, spendableCommitments: readonly AccountCommitment[]): PoolAccountRef[];
export declare function getNextPoolAccountNumber(account: PrivacyPoolAccount | null | undefined, scope: bigint): number;
