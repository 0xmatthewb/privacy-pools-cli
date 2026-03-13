import { describe, expect, test } from "bun:test";
import type { AccountCommitment, PrivacyPoolAccount } from "@0xbow/privacy-pools-core-sdk";
import {
  buildAllPoolAccountRefs,
  buildPoolAccountRefs,
  describeUnavailablePoolAccount,
  getNextPoolAccountNumber,
  getUnknownPoolAccountError,
  parsePoolAccountSelector,
} from "../../src/utils/pool-accounts.ts";

function commitment(
  label: bigint,
  hash: bigint,
  value: bigint,
  blockNumber: bigint,
  txHash: `0x${string}`
): AccountCommitment {
  return {
    label,
    hash,
    value,
    blockNumber,
    txHash,
    nullifier: 111n as any,
    secret: 222n as any,
  };
}

describe("pool account mapping", () => {
  test("buildAllPoolAccountRefs includes active, spent, exited, and unmatched accounts", () => {
    const scope = 1001n;
    const c1 = commitment(1n, 11n, 100n, 10n, "0x1111111111111111111111111111111111111111111111111111111111111111");
    const c2Deposit = commitment(2n, 22n, 200n, 20n, "0x2222222222222222222222222222222222222222222222222222222222222222");
    const c2Spent = commitment(2n, 222n, 0n, 21n, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const c3 = commitment(3n, 33n, 300n, 30n, "0x3333333333333333333333333333333333333333333333333333333333333333");
    const orphan = commitment(9n, 99n, 50n, 90n, "0x9999999999999999999999999999999999999999999999999999999999999999");

    const account: PrivacyPoolAccount = {
      masterKeys: [1n as any, 2n as any],
      poolAccounts: new Map([
        [scope as any, [
          { label: c1.label as any, deposit: c1, children: [] },
          { label: c2Deposit.label as any, deposit: c2Deposit, children: [c2Spent] },
          {
            label: c3.label as any,
            deposit: c3,
            children: [],
            ragequit: {
              ragequitter: "0x1111111111111111111111111111111111111111",
              commitment: c3.hash as any,
              label: c3.label as any,
              value: c3.value,
              blockNumber: 333n,
              transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          },
        ]],
      ]) as any,
    };

    const all = buildAllPoolAccountRefs(account, scope, [c1, orphan]);
    expect(all.map((row) => row.paId)).toEqual(["PA-1", "PA-2", "PA-3", "PA-4"]);
    expect(all.map((row) => row.status)).toEqual(["unknown", "spent", "exited", "unknown"]);
    expect(all[0].value).toBe(100n);
    expect(all[1].value).toBe(0n);
    expect(all[2].value).toBe(0n);
    expect(all[2].blockNumber).toBe(333n);
    expect(all[2].txHash).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(all[3].value).toBe(50n);

    const activeOnly = buildPoolAccountRefs(account, scope, [c1, orphan]);
    expect(activeOnly.map((row) => row.paId)).toEqual(["PA-1", "PA-4"]);
    expect(activeOnly.every((row) => row.status === "unknown")).toBe(true);
  });

  test("getNextPoolAccountNumber follows existing scope length", () => {
    const scope = 2002n;
    const account: PrivacyPoolAccount = {
      masterKeys: [3n as any, 4n as any],
      poolAccounts: new Map([
        [scope as any, [{ label: 1n as any, deposit: commitment(1n, 1n, 1n, 1n, "0x1111111111111111111111111111111111111111111111111111111111111111"), children: [] }]],
      ]) as any,
    };

    expect(getNextPoolAccountNumber(account, scope)).toBe(2);
    expect(getNextPoolAccountNumber(account, 9999n)).toBe(1);
  });

  test("parsePoolAccountSelector accepts PA and numeric forms", () => {
    expect(parsePoolAccountSelector("PA-1")).toBe(1);
    expect(parsePoolAccountSelector("pa-12")).toBe(12);
    expect(parsePoolAccountSelector("12")).toBe(12);
    expect(parsePoolAccountSelector("  pa-3  ")).toBe(3);
    expect(parsePoolAccountSelector("PA-0")).toBeNull();
    expect(parsePoolAccountSelector("foo")).toBeNull();
  });

  test("review statuses surface declined accounts and keep approved gated by ASP leaves", () => {
    const scope = 3003n;
    const approved = commitment(
      10n,
      101n,
      100n,
      10n,
      "0x1010101010101010101010101010101010101010101010101010101010101010",
    );
    const declined = commitment(
      20n,
      202n,
      200n,
      20n,
      "0x2020202020202020202020202020202020202020202020202020202020202020",
    );
    const poiRequired = commitment(
      25n,
      252n,
      250n,
      25n,
      "0x2525252525252525252525252525252525252525252525252525252525252525",
    );
    const approvedButLeafPending = commitment(
      30n,
      303n,
      300n,
      30n,
      "0x3030303030303030303030303030303030303030303030303030303030303030",
    );

    const account: PrivacyPoolAccount = {
      masterKeys: [5n as any, 6n as any],
      poolAccounts: new Map([
        [scope as any, [
          { label: approved.label as any, deposit: approved, children: [] },
          { label: declined.label as any, deposit: declined, children: [] },
          { label: poiRequired.label as any, deposit: poiRequired, children: [] },
          { label: approvedButLeafPending.label as any, deposit: approvedButLeafPending, children: [] },
        ]],
      ]) as any,
    };

    const refs = buildAllPoolAccountRefs(
      account,
      scope,
      [approved, declined, poiRequired, approvedButLeafPending],
      new Set([approved.label.toString()]),
      new Map([
        [approved.label.toString(), "approved"],
        [declined.label.toString(), "declined"],
        [poiRequired.label.toString(), "poi_required"],
        [approvedButLeafPending.label.toString(), "approved"],
      ]),
    );

    expect(refs.map((row) => row.status)).toEqual(["approved", "declined", "poi_required", "pending"]);
    expect(refs.map((row) => row.aspStatus)).toEqual(["approved", "declined", "poi_required", "pending"]);
  });

  test("approved review statuses fail closed when ASP leaves are unavailable", () => {
    const scope = 4004n;
    const approved = commitment(
      10n,
      101n,
      100n,
      10n,
      "0x1010101010101010101010101010101010101010101010101010101010101010",
    );
    const declined = commitment(
      20n,
      202n,
      200n,
      20n,
      "0x2020202020202020202020202020202020202020202020202020202020202020",
    );

    const account: PrivacyPoolAccount = {
      masterKeys: [5n as any, 6n as any],
      poolAccounts: new Map([
        [scope as any, [
          { label: approved.label as any, deposit: approved, children: [] },
          { label: declined.label as any, deposit: declined, children: [] },
        ]],
      ]) as any,
    };

    const refs = buildAllPoolAccountRefs(
      account,
      scope,
      [approved, declined],
      null,
      new Map([
        [approved.label.toString(), "approved"],
        [declined.label.toString(), "declined"],
      ]),
    );

    expect(refs.map((row) => row.status)).toEqual(["unknown", "declined"]);
    expect(refs.map((row) => row.aspStatus)).toEqual(["unknown", "declined"]);
  });

  test("missing per-label review rows fail closed instead of guessing pending", () => {
    const scope = 5005n;
    const approved = commitment(
      10n,
      101n,
      100n,
      10n,
      "0x1010101010101010101010101010101010101010101010101010101010101010",
    );
    const missingStatus = commitment(
      20n,
      202n,
      200n,
      20n,
      "0x2020202020202020202020202020202020202020202020202020202020202020",
    );

    const account: PrivacyPoolAccount = {
      masterKeys: [5n as any, 6n as any],
      poolAccounts: new Map([
        [scope as any, [
          { label: approved.label as any, deposit: approved, children: [] },
          { label: missingStatus.label as any, deposit: missingStatus, children: [] },
        ]],
      ]) as any,
    };

    const refs = buildAllPoolAccountRefs(
      account,
      scope,
      [approved, missingStatus],
      new Set([approved.label.toString()]),
      new Map([[approved.label.toString(), "approved"]]),
    );

    expect(refs.map((row) => row.status)).toEqual(["approved", "unknown"]);
    expect(refs.map((row) => row.aspStatus)).toEqual(["approved", "unknown"]);
  });

  test("describeUnavailablePoolAccount explains spent and exited states", () => {
    expect(
      describeUnavailablePoolAccount({ paId: "PA-2", status: "spent" }, "withdraw"),
    ).toContain("already fully withdrawn");
    expect(
      describeUnavailablePoolAccount({ paId: "PA-3", status: "exited" }, "ragequit"),
    ).toContain("already exited publicly");
    expect(
      describeUnavailablePoolAccount({ paId: "PA-1", status: "approved" }, "withdraw"),
    ).toBeNull();
  });

  test("getUnknownPoolAccountError explains when a specific selector cannot exist yet", () => {
    expect(
      getUnknownPoolAccountError({
        paNumber: 2,
        symbol: "ETH",
        chainName: "sepolia",
        knownPoolAccountsCount: 0,
      }),
    ).toEqual({
      message: "Unknown Pool Account PA-2 for ETH.",
      hint:
        "No local Pool Accounts are available for ETH on sepolia yet. Deposit first, then run 'privacy-pools accounts --chain sepolia' to confirm available Pool Accounts.",
    });
  });

  test("getUnknownPoolAccountError keeps the normal listing hint when accounts exist", () => {
    expect(
      getUnknownPoolAccountError({
        paNumber: 3,
        symbol: "ETH",
        chainName: "mainnet",
        knownPoolAccountsCount: 1,
      }),
    ).toEqual({
      message: "Unknown Pool Account PA-3 for ETH.",
      hint: "Run 'privacy-pools accounts --chain mainnet' to list available Pool Accounts.",
    });
  });
});
