import { describe, expect, test } from "bun:test";
import { selectBestWithdrawalCommitment } from "../../src/utils/withdrawal.ts";

describe("withdrawal commitment selection", () => {
  test("selects smallest eligible commitment by value", () => {
    const commitments = [
      { label: 10n, value: 5n },
      { label: 11n, value: 2n },
      { label: 12n, value: 9n },
    ];

    const selected = selectBestWithdrawalCommitment(commitments, 3n);
    expect(selected.kind).toBe("ok");
    if (selected.kind === "ok") {
      expect(selected.commitment.label).toBe(10n);
      expect(selected.commitment.value).toBe(5n);
    }
  });

  test("selects smallest eligible commitment that is ASP-approved", () => {
    const commitments = [
      { label: 100n, value: 4n },
      { label: 200n, value: 5n },
      { label: 300n, value: 7n },
    ];

    const selected = selectBestWithdrawalCommitment(
      commitments,
      4n,
      new Set([300n, 200n])
    );

    expect(selected.kind).toBe("ok");
    if (selected.kind === "ok") {
      expect(selected.commitment.label).toBe(200n);
      expect(selected.commitment.value).toBe(5n);
      expect(selected.eligibleCount).toBe(3);
      expect(selected.approvedEligibleCount).toBe(2);
    }
  });

  test("returns unapproved when balance is sufficient but labels are not approved", () => {
    const commitments = [
      { label: 1n, value: 10n },
      { label: 2n, value: 20n },
    ];

    const selected = selectBestWithdrawalCommitment(
      commitments,
      8n,
      new Set([99n])
    );

    expect(selected.kind).toBe("unapproved");
    if (selected.kind === "unapproved") {
      expect(selected.eligibleCount).toBe(2);
      expect(selected.approvedEligibleCount).toBe(0);
    }
  });

  test("returns insufficient with largest available balance", () => {
    const commitments = [
      { label: 1n, value: 2n },
      { label: 2n, value: 3n },
      { label: 3n, value: 1n },
    ];

    const selected = selectBestWithdrawalCommitment(commitments, 4n);
    expect(selected.kind).toBe("insufficient");
    if (selected.kind === "insufficient") {
      expect(selected.largestAvailable).toBe(3n);
      expect(selected.eligibleCount).toBe(0);
    }
  });

  test("uses label as deterministic tie-breaker for equal values", () => {
    const commitments = [
      { label: 9n, value: 5n },
      { label: 3n, value: 5n },
      { label: 5n, value: 5n },
    ];

    const selected = selectBestWithdrawalCommitment(commitments, 5n);
    expect(selected.kind).toBe("ok");
    if (selected.kind === "ok") {
      expect(selected.commitment.label).toBe(3n);
      expect(selected.commitment.value).toBe(5n);
    }
  });
});
