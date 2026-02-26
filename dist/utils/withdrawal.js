function byValueThenLabel(a, b) {
    if (a.value < b.value)
        return -1;
    if (a.value > b.value)
        return 1;
    if (a.label < b.label)
        return -1;
    if (a.label > b.label)
        return 1;
    return 0;
}
export function selectBestWithdrawalCommitment(commitments, withdrawalAmount, approvedLabels) {
    const largestAvailable = commitments.reduce((max, c) => (c.value > max ? c.value : max), 0n);
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
