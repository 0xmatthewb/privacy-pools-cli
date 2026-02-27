import { describe, expect, test } from "bun:test";
import type { AccountCommitment, PrivacyPoolAccount } from "@0xbow/privacy-pools-core-sdk";
import {
  buildAllPoolAccountRefs,
  buildPoolAccountRefs,
  getNextPoolAccountNumber,
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
  test("buildAllPoolAccountRefs includes spendable, spent, exited, and unmatched spendables", () => {
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
    expect(all.map((row) => row.status)).toEqual(["spendable", "spent", "exited", "spendable"]);
    expect(all[0].value).toBe(100n);
    expect(all[1].value).toBe(0n);
    expect(all[2].value).toBe(0n);
    expect(all[2].blockNumber).toBe(333n);
    expect(all[2].txHash).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(all[3].value).toBe(50n);

    const spendableOnly = buildPoolAccountRefs(account, scope, [c1, orphan]);
    expect(spendableOnly.map((row) => row.paId)).toEqual(["PA-1", "PA-4"]);
    expect(spendableOnly.every((row) => row.status === "spendable")).toBe(true);
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
});
