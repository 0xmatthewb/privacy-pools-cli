export interface SpendableCommitmentLike {
    value: bigint;
    label: bigint;
}
export type CommitmentSelectionResult<T extends SpendableCommitmentLike> = {
    kind: "ok";
    commitment: T;
    eligibleCount: number;
    approvedEligibleCount: number;
} | {
    kind: "insufficient";
    largestAvailable: bigint;
    eligibleCount: 0;
    approvedEligibleCount: 0;
} | {
    kind: "unapproved";
    eligibleCount: number;
    approvedEligibleCount: 0;
};
export declare function selectBestWithdrawalCommitment<T extends SpendableCommitmentLike>(commitments: readonly T[], withdrawalAmount: bigint, approvedLabels?: ReadonlySet<bigint>): CommitmentSelectionResult<T>;
