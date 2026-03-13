import { describe, expect, test } from "bun:test";
import {
  formatApprovalResolutionHint,
  getRelayedWithdrawalRemainderAdvisory,
} from "../../src/commands/withdraw.ts";

describe("getRelayedWithdrawalRemainderAdvisory", () => {
  test("returns null when no remainder remains", () => {
    expect(
      getRelayedWithdrawalRemainderAdvisory({
        remainingBalance: 0n,
        minWithdrawAmount: 100000000000000000n,
        poolAccountId: "PA-1",
        assetSymbol: "ETH",
        decimals: 18,
      }),
    ).toBeNull();
  });

  test("returns null when remaining balance stays above the relayer minimum", () => {
    expect(
      getRelayedWithdrawalRemainderAdvisory({
        remainingBalance: 200000000000000000n,
        minWithdrawAmount: 100000000000000000n,
        poolAccountId: "PA-1",
        assetSymbol: "ETH",
        decimals: 18,
      }),
    ).toBeNull();
  });

  test("warns when relayed withdrawal strands a remainder below the relayer minimum", () => {
    const advisory = getRelayedWithdrawalRemainderAdvisory({
      remainingBalance: 50000000000000000n,
      minWithdrawAmount: 100000000000000000n,
      poolAccountId: "PA-3",
      assetSymbol: "ETH",
      decimals: 18,
    });

    expect(advisory).toContain("PA-3");
    expect(advisory).toContain("0.05 ETH");
    expect(advisory).toContain("0.1 ETH");
    expect(advisory).toContain("--all/100%");
    expect(advisory).toContain("ragequit");
  });
});

describe("formatApprovalResolutionHint", () => {
  test("explains declined Pool Accounts are exit-only", () => {
    const hint = formatApprovalResolutionHint({
      chainName: "sepolia",
      assetSymbol: "ETH",
      poolAccountId: "PA-4",
      status: "declined",
    });

    expect(hint).toContain("declined by the ASP");
    expect(hint).toContain("including --direct");
    expect(hint).toContain("privacy-pools ragequit --chain sepolia --asset ETH --from-pa PA-4");
  });

  test("explains poi_required Pool Accounts need PoA before withdraw", () => {
    const hint = formatApprovalResolutionHint({
      chainName: "mainnet",
      assetSymbol: "ETH",
      poolAccountId: "PA-2",
      status: "poi_required",
    });

    expect(hint).toContain("Proof of Association");
    expect(hint).toContain("tornado.0xbow.io");
    expect(hint).toContain("privacy-pools ragequit --chain mainnet --asset ETH --from-pa PA-2");
  });

  test("unknown unapproved state points users back to accounts for final status", () => {
    const hint = formatApprovalResolutionHint({
      chainName: "sepolia",
      assetSymbol: "ETH",
      poolAccountId: "PA-7",
      status: "unknown",
    });

    expect(hint).toContain("privacy-pools accounts --json --chain sepolia");
    expect(hint).toContain("Pending deposits need more time");
    expect(hint).toContain("declined deposits must use");
  });
});
