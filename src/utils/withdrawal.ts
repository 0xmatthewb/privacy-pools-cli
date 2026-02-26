export interface SpendableCommitmentLike {
  value: bigint;
  label: bigint;
}

export type CommitmentSelectionResult<T extends SpendableCommitmentLike> =
  | {
      kind: "ok";
      commitment: T;
      eligibleCount: number;
      approvedEligibleCount: number;
    }
  | {
      kind: "insufficient";
      largestAvailable: bigint;
      eligibleCount: 0;
      approvedEligibleCount: 0;
    }
  | {
      kind: "unapproved";
      eligibleCount: number;
      approvedEligibleCount: 0;
    };

function byValueThenLabel<T extends SpendableCommitmentLike>(a: T, b: T): number {
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  if (a.label < b.label) return -1;
  if (a.label > b.label) return 1;
  return 0;
}

export function selectBestWithdrawalCommitment<T extends SpendableCommitmentLike>(
  commitments: readonly T[],
  withdrawalAmount: bigint,
  approvedLabels?: ReadonlySet<bigint>
): CommitmentSelectionResult<T> {
  const largestAvailable = commitments.reduce(
    (max, c) => (c.value > max ? c.value : max),
    0n
  );

  const eligible = commitments
    .filter((c) => c.value >= withdrawalAmount)
    .sort(byValueThenLabel);

  if (eligible.length === 0) {
    return {
      kind: "insufficient",
      largestAvailable,
      eligibleCount: 0,
      approvedEligibleCount: 0,
    };
  }

  if (!approvedLabels) {
    return {
      kind: "ok",
      commitment: eligible[0],
      eligibleCount: eligible.length,
      approvedEligibleCount: eligible.length,
    };
  }

  const approvedEligible = eligible
    .filter((c) => approvedLabels.has(c.label))
    .sort(byValueThenLabel);

  if (approvedEligible.length === 0) {
    return {
      kind: "unapproved",
      eligibleCount: eligible.length,
      approvedEligibleCount: 0,
    };
  }

  return {
    kind: "ok",
    commitment: approvedEligible[0],
    eligibleCount: eligible.length,
    approvedEligibleCount: approvedEligible.length,
  };
}
