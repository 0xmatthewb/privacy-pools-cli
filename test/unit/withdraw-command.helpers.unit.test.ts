import { describe, expect, test } from "bun:test";
import type { PoolAccountRef } from "../../src/utils/pool-accounts.ts";
import {
  formatApprovalResolutionHint,
  getEligibleUnapprovedStatuses,
  getRelayedWithdrawalRemainderAdvisory,
  normalizeRelayerQuoteExpirationMs,
  refreshExpiredRelayerQuoteForWithdrawal,
  validateRelayerQuoteForWithdrawal,
} from "../../src/commands/withdraw.ts";

function makePoolAccountRef(
  status: PoolAccountRef["status"],
  value: bigint,
  patch: Partial<PoolAccountRef> = {},
): PoolAccountRef {
  return {
    paNumber: 1,
    paId: "PA-1",
    status,
    aspStatus: status,
    commitment: {
      hash: 11n,
      label: 22n,
      value,
      blockNumber: 33n,
      txHash: "0x" + "aa".repeat(32),
    },
    label: 22n,
    value,
    blockNumber: 33n,
    txHash: "0x" + "aa".repeat(32),
    ...patch,
  };
}

function makeQuote(
  patch: {
    expiration?: number;
    feeBPS?: string;
    feeCommitment?: Record<string, unknown> | null;
  } = {},
) {
  const feeCommitment = patch.feeCommitment === null
    ? undefined
    : {
        expiration: patch.expiration ?? 2_000,
        withdrawalData: "0x" + "11".repeat(32),
        asset: "0x" + "22".repeat(20),
        amount: "1000000",
        extraGas: false,
        signedRelayerCommitment: "0x" + "33".repeat(32),
        ...patch.feeCommitment,
      };

  return {
    baseFeeBPS: "25",
    feeBPS: patch.feeBPS ?? "50",
    gasPrice: "1",
    detail: {
      relayTxCost: { gas: "21000", eth: "1" },
    },
    ...(feeCommitment ? { feeCommitment } : {}),
  };
}

describe("withdraw command helpers", () => {
  test("collects deduplicated eligible unapproved statuses for the requested amount", () => {
    expect(
      getEligibleUnapprovedStatuses(
        [
          makePoolAccountRef("approved", 15n),
          makePoolAccountRef("pending", 15n),
          makePoolAccountRef("pending", 25n, { paNumber: 2, paId: "PA-2" }),
          makePoolAccountRef("poa_required", 20n, { paNumber: 3, paId: "PA-3" }),
          makePoolAccountRef("declined", 20n, { paNumber: 4, paId: "PA-4" }),
          makePoolAccountRef("unknown", 20n, { paNumber: 5, paId: "PA-5" }),
          makePoolAccountRef("pending", 5n, { paNumber: 6, paId: "PA-6" }),
        ],
        10n,
      ),
    ).toEqual(["pending", "poa_required", "declined", "unknown"]);
  });

  test("formats approval resolution hints for each supported review state", () => {
    expect(
      formatApprovalResolutionHint({
        chainName: "sepolia",
        assetSymbol: "ETH",
        poolAccountId: "PA-7",
        status: "pending",
      }),
    ).toContain("ASP approval is required");

    expect(
      formatApprovalResolutionHint({
        chainName: "sepolia",
        assetSymbol: "ETH",
        poolAccountId: "PA-7",
        status: "poa_required",
      }),
    ).toContain("Proof of Association");

    expect(
      formatApprovalResolutionHint({
        chainName: "sepolia",
        assetSymbol: "ETH",
        poolAccountId: "PA-7",
        status: "declined",
      }),
    ).toContain("Ragequit is available");

    expect(
      formatApprovalResolutionHint({
        chainName: "sepolia",
        assetSymbol: "ETH",
      }),
    ).toContain("privacy-pools ragequit --chain sepolia --asset ETH --pool-account <PA-#>");
  });

  test("renders a relayer minimum remainder advisory only when the remainder is stranded", () => {
    expect(
      getRelayedWithdrawalRemainderAdvisory({
        remainingBalance: 0n,
        minWithdrawAmount: 5n,
        poolAccountId: "PA-3",
        assetSymbol: "ETH",
        decimals: 18,
      }),
    ).toBeNull();

    expect(
      getRelayedWithdrawalRemainderAdvisory({
        remainingBalance: 10n,
        minWithdrawAmount: 5n,
        poolAccountId: "PA-3",
        assetSymbol: "ETH",
        decimals: 18,
      }),
    ).toBeNull();

    const advisory = getRelayedWithdrawalRemainderAdvisory({
      remainingBalance: 2n,
      minWithdrawAmount: 5n,
      poolAccountId: "PA-3",
      assetSymbol: "ETH",
      decimals: 18,
    });

    expect(advisory).toContain("PA-3 would keep");
    expect(advisory).toContain("below the relayer minimum");
    expect(advisory).toContain("ragequit the remainder later");
  });

  test("normalizes quote expiration timestamps from seconds and milliseconds", () => {
    expect(normalizeRelayerQuoteExpirationMs(1_710_000_000)).toBe(1_710_000_000_000);
    expect(normalizeRelayerQuoteExpirationMs(1_710_000_000_000)).toBe(1_710_000_000_000);
  });

  test("validates quote fee details and normalizes the expiration timestamp", () => {
    expect(
      validateRelayerQuoteForWithdrawal(makeQuote({ expiration: 321 }), "500"),
    ).toEqual({
      quoteFeeBPS: 50n,
      expirationMs: 321_000,
    });
  });

  test("rejects relayer quotes that omit fee details", () => {
    expect(() =>
      validateRelayerQuoteForWithdrawal(makeQuote({ feeCommitment: null }), "500"),
    ).toThrow("missing required fee details");
  });

  test("rejects relayer quotes with malformed or excessive fee bps", () => {
    expect(() =>
      validateRelayerQuoteForWithdrawal(makeQuote({ feeBPS: "fifty" }), 500n),
    ).toThrow("malformed feeBPS");

    expect(() =>
      validateRelayerQuoteForWithdrawal(makeQuote({ feeBPS: "750" }), 500n),
    ).toThrow("exceeds onchain maximum");
  });

  test("refreshes expired relayer quotes until one is still valid", async () => {
    const attempts: number[] = [];
    const retries: Array<[number, number]> = [];
    const quotes = [
      makeQuote({ expiration: 0 }),
      makeQuote({ expiration: 2, feeBPS: "75" }),
    ];

    const result = await refreshExpiredRelayerQuoteForWithdrawal({
      fetchQuote: async () => {
        attempts.push(attempts.length + 1);
        return quotes.shift()!;
      },
      maxRelayFeeBPS: "500",
      nowMs: () => 1_000,
      onRetry: (attempt, maxAttempts) => {
        retries.push([attempt, maxAttempts]);
      },
    });

    expect(attempts).toEqual([1, 2]);
    expect(retries).toEqual([[2, 3]]);
    expect(result.attempts).toBe(2);
    expect(result.quoteFeeBPS).toBe(75n);
    expect(result.expirationMs).toBe(2_000);
  });

  test("fails closed when the relayer keeps returning expired quotes", async () => {
    await expect(
      refreshExpiredRelayerQuoteForWithdrawal({
        fetchQuote: async () => makeQuote({ expiration: 0 }),
        maxRelayFeeBPS: "500",
        nowMs: () => 1_000,
        maxAttempts: 2,
      }),
    ).rejects.toThrow("stale/expired quotes repeatedly");
  });
});
