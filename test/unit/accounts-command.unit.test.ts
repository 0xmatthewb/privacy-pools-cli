import { describe, expect, test } from "bun:test";
import {
  collectAccountScopeStrings,
  describeAccountsChainScope,
  formatAccountsLoadingText,
  hasIncompleteAspReviewData,
} from "../../src/commands/accounts.ts";

describe("accounts loading helpers", () => {
  test("describeAccountsChainScope reflects the selected multi-chain scope", () => {
    expect(describeAccountsChainScope(true)).toBe("all chains");
    expect(describeAccountsChainScope(false)).toBe("mainnet chains");
    expect(describeAccountsChainScope(undefined)).toBe("mainnet chains");
  });

  test("formatAccountsLoadingText adds per-chain progress only when available", () => {
    expect(formatAccountsLoadingText(false)).toBe(
      "Loading My Pools across mainnet chains...",
    );
    expect(formatAccountsLoadingText(true, 2, 3)).toBe(
      "Loading My Pools across all chains... (2/3 complete)",
    );
  });
});

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

  test("ignores historical scopes when account storage is not a Map", () => {
    const spendable = new Map<bigint, readonly unknown[]>([
      [5n, []],
    ]);

    expect(
      collectAccountScopeStrings(
        spendable,
        { poolAccounts: { unexpected: true } },
        true,
      ),
    ).toEqual(["5"]);
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
