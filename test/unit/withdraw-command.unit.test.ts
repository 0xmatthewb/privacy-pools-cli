import { describe, expect, test } from "bun:test";
import {
  formatApprovalResolutionHint,
  getEligibleUnapprovedStatuses,
  getRelayedWithdrawalRemainderAdvisory,
  normalizeRelayerQuoteExpirationMs,
  refreshExpiredRelayerQuoteForWithdrawal,
  validateRelayerQuoteForWithdrawal,
} from "../../src/commands/withdraw.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";
import type { PoolAccountRef } from "../../src/utils/pool-accounts.ts";
import { encodeRelayerWithdrawalData } from "../helpers/relayer-withdrawal-data.ts";

function samplePoolAccount(
  patch: Partial<PoolAccountRef> = {},
): PoolAccountRef {
  return {
    paNumber: 1,
    paId: "PA-1",
    status: "approved",
    aspStatus: "approved",
    commitment: {
      hash: 1n,
      label: 11n,
      value: 500n,
      blockNumber: 10n,
      txHash: "0x" + "aa".repeat(32),
    },
    label: 11n,
    value: 500n,
    blockNumber: 10n,
    txHash: "0x" + "aa".repeat(32),
    ...patch,
  };
}

describe("getEligibleUnapprovedStatuses", () => {
  test("returns the distinct non-approved statuses that can cover the withdrawal", () => {
    expect(
      getEligibleUnapprovedStatuses(
        [
          samplePoolAccount({ status: "approved", aspStatus: "approved" }),
          samplePoolAccount({ paNumber: 2, paId: "PA-2", status: "pending", aspStatus: "pending" }),
          samplePoolAccount({ paNumber: 3, paId: "PA-3", status: "poa_required", aspStatus: "poa_required" }),
          samplePoolAccount({ paNumber: 4, paId: "PA-4", status: "declined", aspStatus: "declined" }),
          samplePoolAccount({ paNumber: 5, paId: "PA-5", status: "unknown", aspStatus: "unknown" }),
          samplePoolAccount({ paNumber: 6, paId: "PA-6", status: "pending", aspStatus: "pending" }),
        ],
        400n,
      ),
    ).toEqual(["pending", "poa_required", "declined", "unknown"]);
  });

  test("ignores Pool Accounts that are approved or too small", () => {
    expect(
      getEligibleUnapprovedStatuses(
        [
          samplePoolAccount({ status: "approved", aspStatus: "approved", value: 1_000n }),
          samplePoolAccount({ paNumber: 2, paId: "PA-2", status: "pending", aspStatus: "pending", value: 100n }),
          samplePoolAccount({ paNumber: 3, paId: "PA-3", status: "unknown", aspStatus: "unknown", value: 200n }),
        ],
        300n,
      ),
    ).toEqual([]);
  });
});

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
  test("explains pending Pool Accounts need more ASP review time", () => {
    const hint = formatApprovalResolutionHint({
      chainName: "sepolia",
      assetSymbol: "ETH",
      poolAccountId: "PA-3",
      status: "pending",
    });

    expect(hint).toContain("ASP approval is required");
    expect(hint).toContain("privacy-pools accounts --chain sepolia");
    expect(hint).toContain("up to 7 days");
  });

  test("explains declined Pool Accounts are exit-only", () => {
    const hint = formatApprovalResolutionHint({
      chainName: "sepolia",
      assetSymbol: "ETH",
      poolAccountId: "PA-4",
      status: "declined",
    });

    expect(hint).toContain("declined by the ASP");
    expect(hint).toContain("including --direct");
    expect(hint).toContain("privacy-pools ragequit ETH --chain sepolia --pool-account PA-4");
  });

  test("explains poa_required Pool Accounts need PoA before withdraw", () => {
    const hint = formatApprovalResolutionHint({
      chainName: "mainnet",
      assetSymbol: "ETH",
      poolAccountId: "PA-2",
      status: "poa_required",
    });

    expect(hint).toContain("Proof of Association");
    expect(hint).toContain(POA_PORTAL_URL);
    expect(hint).toContain("privacy-pools ragequit ETH --chain mainnet --pool-account PA-2");
  });

  test("unknown unapproved state points users back to accounts for final status", () => {
    const hint = formatApprovalResolutionHint({
      chainName: "sepolia",
      assetSymbol: "ETH",
      poolAccountId: "PA-7",
      status: "unknown",
    });

    expect(hint).toContain("privacy-pools accounts --chain sepolia");
    expect(hint).toContain("Pending deposits need more time");
    expect(hint).toContain("declined deposits can be recovered publicly via ragequit");
  });
});

describe("relayer quote helpers", () => {
  const validQuote = {
    baseFeeBPS: "200",
    feeBPS: "250",
    gasPrice: "1",
    detail: { relayTxCost: { gas: "0", eth: "0" } },
    feeCommitment: {
      expiration: 4_102_444_800_000,
      withdrawalData: encodeRelayerWithdrawalData({
        recipient: "0x4444444444444444444444444444444444444444",
        feeRecipient: "0x3333333333333333333333333333333333333333",
        relayFeeBPS: 250n,
      }),
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      amount: "100000000000000000",
      extraGas: false,
      signedRelayerCommitment: "0x01",
    },
  } as const;

  test("normalizes second-based relayer quote expirations into milliseconds", () => {
    expect(normalizeRelayerQuoteExpirationMs(4_102_444_800)).toBe(
      4_102_444_800_000,
    );
    expect(normalizeRelayerQuoteExpirationMs(4_102_444_800_000)).toBe(
      4_102_444_800_000,
    );
  });

  test("validates quote fee and expiration for withdrawal use", () => {
    const validated = validateRelayerQuoteForWithdrawal(validQuote, 250n);

    expect(validated.quoteFeeBPS).toBe(250n);
    expect(validated.expirationMs).toBe(4_102_444_800_000);
  });

  test("rejects relayer quotes without feeCommitment", () => {
    expect(() =>
      validateRelayerQuoteForWithdrawal(
        { ...validQuote, feeCommitment: undefined },
        250n,
      ),
    ).toThrow(CLIError);
  });

  test("rejects malformed feeBPS strings", () => {
    expect(() =>
      validateRelayerQuoteForWithdrawal(
        { ...validQuote, feeBPS: "oops" },
        250n,
      ),
    ).toThrow(CLIError);
  });

  test("rejects relay fees above the pool maximum", () => {
    expect(() =>
      validateRelayerQuoteForWithdrawal(validQuote, 200n),
    ).toThrow(CLIError);
  });

  test("refreshes stale quotes until a fresh quote is returned", async () => {
    let calls = 0;
    const refreshed = await refreshExpiredRelayerQuoteForWithdrawal({
      nowMs: () => 1_500_000,
      maxRelayFeeBPS: 250n,
      fetchQuote: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ...validQuote,
            feeCommitment: {
              ...validQuote.feeCommitment,
              expiration: 1_000,
            },
          };
        }

        return {
          ...validQuote,
          feeCommitment: {
            ...validQuote.feeCommitment,
            expiration: 3_000,
          },
        };
      },
    });

    expect(calls).toBe(2);
    expect(refreshed.attempts).toBe(2);
    expect(refreshed.quoteFeeBPS).toBe(250n);
    expect(refreshed.expirationMs).toBe(3_000_000);
  });

  test("accepts a fresh relayer quote on the first attempt", async () => {
    const refreshed = await refreshExpiredRelayerQuoteForWithdrawal({
      nowMs: () => 1_000,
      maxRelayFeeBPS: "250",
      fetchQuote: async () => validQuote,
    });

    expect(refreshed.attempts).toBe(1);
    expect(refreshed.quote).toEqual(validQuote);
    expect(refreshed.quoteFeeBPS).toBe(250n);
    expect(refreshed.expirationMs).toBe(4_102_444_800_000);
  });

  test("fails closed when refreshed quotes stay expired", async () => {
    await expect(
      refreshExpiredRelayerQuoteForWithdrawal({
        nowMs: () => 5_000_000,
        maxRelayFeeBPS: 250n,
        maxAttempts: 2,
        fetchQuote: async () => ({
          ...validQuote,
          feeCommitment: {
            ...validQuote.feeCommitment,
            expiration: 1_000,
          },
        }),
      }),
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: "Relayer returned stale/expired quotes repeatedly.",
    });
  });

  test("propagates quote validation failures while refreshing", async () => {
    await expect(
      refreshExpiredRelayerQuoteForWithdrawal({
        nowMs: () => 1_000,
        maxRelayFeeBPS: 100n,
        fetchQuote: async () => validQuote,
      }),
    ).rejects.toThrow("exceeds onchain maximum");
  });
});
