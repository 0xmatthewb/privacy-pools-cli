import { describe, expect, test } from "bun:test";
import {
  collectAccountScopeStrings,
  hasIncompleteAspReviewData,
} from "../../src/commands/accounts.ts";

describe("collectAccountScopeStrings", () => {
  test("includes historical-only scopes when requested", () => {
    const spendable = new Map<bigint, readonly unknown[]>([
      [12345n, []],
    ]);
    const account = {
      poolAccounts: new Map<bigint, unknown[]>([
        [12345n, []],
        [67890n, []],
      ]),
    };

    expect(collectAccountScopeStrings(spendable, account, true)).toEqual([
      "12345",
      "67890",
    ]);
  });

  test("omits historical-only scopes unless requested", () => {
    const spendable = new Map<bigint, readonly unknown[]>([
      [12345n, []],
    ]);
    const account = {
      poolAccounts: new Map<bigint, unknown[]>([
        [12345n, []],
        [67890n, []],
      ]),
    };

    expect(collectAccountScopeStrings(spendable, account, false)).toEqual([
      "12345",
    ]);
  });

  test("sorts scope strings numerically", () => {
    const spendable = new Map<bigint, readonly unknown[]>([
      [20n, []],
      [3n, []],
    ]);

    expect(collectAccountScopeStrings(spendable, null, false)).toEqual([
      "3",
      "20",
    ]);
  });
});

describe("hasIncompleteAspReviewData", () => {
  test("returns false when there are no active labels", () => {
    expect(hasIncompleteAspReviewData([], null, null)).toBe(false);
  });

  test("returns true when approved ASP leaves are unavailable", () => {
    expect(hasIncompleteAspReviewData(["1"], null, new Map([["1", "approved"]]))).toBe(true);
  });

  test("returns true when per-label ASP review statuses are unavailable", () => {
    expect(hasIncompleteAspReviewData(["1"], new Set(["1"]), null)).toBe(true);
  });

  test("returns true when per-label ASP review statuses omit an active label", () => {
    expect(
      hasIncompleteAspReviewData(
        ["1", "2"],
        new Set(["1"]),
        new Map([["1", "approved"]]),
      ),
    ).toBe(true);
  });

  test("returns false when both ASP status sources are available", () => {
    expect(hasIncompleteAspReviewData(["1"], new Set(["1"]), new Map([["1", "approved"]]))).toBe(false);
  });
});
