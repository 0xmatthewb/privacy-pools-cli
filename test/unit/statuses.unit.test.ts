import { describe, expect, test } from "bun:test";
import {
  extractPublicEventReviewStatus,
  normalizePublicEventReviewStatus,
} from "../../src/utils/statuses.ts";

describe("status helpers", () => {
  test("extracts review status from object-shaped public event payloads", () => {
    expect(
      extractPublicEventReviewStatus({
        decisionStatus: "approved",
      }),
    ).toBe("approved");
    expect(
      extractPublicEventReviewStatus({
        reviewStatus: "declined",
      }),
    ).toBe("declined");
    expect(
      extractPublicEventReviewStatus({
        status: "pending",
      }),
    ).toBe("pending");
  });

  test("treats completed public event types as approved", () => {
    for (const type of ["withdrawal", "migration", "ragequit", "exit"]) {
      expect(normalizePublicEventReviewStatus(type, "declined")).toBe(
        "approved",
      );
    }
  });

  test("falls back to pending only when no public event review status exists", () => {
    expect(normalizePublicEventReviewStatus("deposit", undefined)).toBe(
      "pending",
    );
    expect(normalizePublicEventReviewStatus("deposit", "mystery")).toBe(
      "unknown",
    );
  });
});
