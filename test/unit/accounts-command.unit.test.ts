import { describe, expect, test } from "bun:test";
import { collectAccountScopeStrings } from "../../src/commands/accounts.ts";

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
