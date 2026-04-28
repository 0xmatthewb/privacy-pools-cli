import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PoolAccountRef } from "../../src/utils/pool-accounts.ts";
import {
  buildDirectRecipientMismatchNextActions,
  buildRemainderBelowMinNextActions,
  buildWithdrawQuoteWarnings,
  confirmRecipientIfNew,
  collectKnownWithdrawalRecipients,
  formatApprovalResolutionHint,
  getEligibleUnapprovedStatuses,
  getRelayedWithdrawalRemainderAdvisory,
  getSuspiciousTestnetMinWithdrawFloor,
  relayerHostLabel,
  rememberSuccessfulWithdrawalRecipient,
  normalizeRelayerQuoteExpirationMs,
  refreshExpiredRelayerQuoteForWithdrawal,
  resolveRequestedWithdrawalPoolAccountOrThrow,
  validateRecipientAddressOrEnsInput,
  validateRelayerQuoteForWithdrawal,
  withSuspendedSpinner,
  writeWithdrawalAnonymitySetHint,
} from "../../src/commands/withdraw.ts";
import { captureOutput } from "../helpers/output.ts";
import { createTestWorld, type TestWorld } from "../helpers/test-world.ts";
import { loadRecipientHistoryEntries } from "../../src/services/recipient-history.ts";

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

let world: TestWorld;

describe("withdraw command helpers", () => {
  beforeEach(() => {
    world = createTestWorld({ prefix: "pp-withdraw-helpers-" });
    world.useConfigHome();
  });

  afterEach(async () => {
    await world.teardown();
  });

  test("formats relayer host labels and suspicious testnet minimum floors", () => {
    expect(relayerHostLabel(undefined)).toBeNull();
    expect(relayerHostLabel("https://relayer.example/path")).toBe(
      "relayer.example",
    );
    expect(relayerHostLabel("not a url")).toBe("not a url");

    expect(getSuspiciousTestnetMinWithdrawFloor(18)).toBe(1_000_000_000_000n);
    expect(getSuspiciousTestnetMinWithdrawFloor(6)).toBe(1n);
    expect(getSuspiciousTestnetMinWithdrawFloor(2)).toBe(1n);
  });

  test("buildWithdrawQuoteWarnings only warns for unusually low testnet floors", () => {
    expect(
      buildWithdrawQuoteWarnings({
        chainIsTestnet: false,
        assetSymbol: "ETH",
        minWithdrawAmount: 1n,
        decimals: 18,
      }),
    ).toEqual([]);
    expect(
      buildWithdrawQuoteWarnings({
        chainIsTestnet: true,
        assetSymbol: "USDC",
        minWithdrawAmount: 1n,
        decimals: 6,
      }),
    ).toEqual([]);

    const warnings = buildWithdrawQuoteWarnings({
      chainIsTestnet: true,
      assetSymbol: "ETH",
      minWithdrawAmount: 1n,
      decimals: 18,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("TESTNET_MIN_WITHDRAW_AMOUNT_UNUSUALLY_LOW");
    expect(warnings[0]?.message).toContain("testnet quote");
  });

  test("writeWithdrawalAnonymitySetHint respects silent mode", () => {
    const silent = captureOutput(() =>
      writeWithdrawalAnonymitySetHint(
        { eligible: 4, total: 10, percentage: 40 },
        true,
      ),
    );
    expect(silent.stderr).toBe("");

    const visible = captureOutput(() =>
      writeWithdrawalAnonymitySetHint(
        { eligible: 4, total: 10, percentage: 40 },
        false,
      ),
    );
    expect(visible.stderr).toContain("Estimated anonymity set");
    expect(visible.stderr).toContain("4 of 10 deposits");
  });

  test("buildDirectRecipientMismatchNextActions covers asset and template variants", () => {
    const recipient = "0x1111111111111111111111111111111111111111";
    const signer = "0x2222222222222222222222222222222222222222";

    const withAsset = buildDirectRecipientMismatchNextActions({
      amountInput: "0.5",
      assetInput: "ETH",
      chainName: "mainnet",
      recipientAddress: recipient,
      signerAddress: signer,
    });
    expect(withAsset).toHaveLength(2);
    expect(withAsset[0]?.cliCommand).toContain("privacy-pools withdraw 0.5 ETH");
    expect(withAsset[0]?.cliCommand).toContain("--to 0x1111111111111111111111111111111111111111");
    expect(withAsset[1]?.cliCommand).toContain("--direct");
    expect(withAsset[1]?.cliCommand).not.toContain("--to");

    const template = buildDirectRecipientMismatchNextActions({
      amountInput: "0.5",
      assetInput: null,
      chainName: "mainnet",
      recipientAddress: recipient,
      signerAddress: signer,
    });
    expect(template).toHaveLength(2);
    expect(template[0]?.runnable).toBe(false);
    expect(template[0]?.parameters?.[0]).toMatchObject({
      name: "asset",
      required: true,
    });
  });

  test("buildRemainderBelowMinNextActions adds safer relayed and direct alternatives when available", () => {
    const recipient = "0x3333333333333333333333333333333333333333";

    const actions = buildRemainderBelowMinNextActions({
      chainName: "mainnet",
      asset: "ETH",
      decimals: 18,
      recipient,
      poolAccountId: "PA-4",
      poolAccountValue: 3000000000000000000n,
      minWithdrawAmount: 1000000000000000000n,
      signerAddress: recipient,
    });

    expect(actions.map((action) => action.command)).toEqual([
      "withdraw",
      "withdraw",
      "ragequit",
      "withdraw",
    ]);
    expect(actions[1]?.cliCommand).toContain("2 ETH");
    expect(actions[3]?.cliCommand).toContain("--direct");
  });

  test("recipient helpers validate inputs, warn on new recipients, and persist successful recipients", async () => {
    const signer = "0x4444444444444444444444444444444444444444";
    const recipient = "0x5555555555555555555555555555555555555555";

    expect(validateRecipientAddressOrEnsInput(recipient)).toBe(true);
    expect(validateRecipientAddressOrEnsInput("vitalik.eth")).toBe(true);
    expect(validateRecipientAddressOrEnsInput("definitely not valid")).toContain(
      "Invalid",
    );

    await expect(
      confirmRecipientIfNew({
        address: signer,
        knownRecipients: [signer],
        skipPrompts: false,
        silent: true,
      }),
    ).resolves.toEqual([]);

    const warnings = await confirmRecipientIfNew({
      address: recipient,
      knownRecipients: [signer],
      skipPrompts: true,
      silent: true,
    });
    expect(warnings[0]?.code).toBe("RECIPIENT_NEW_TO_PROFILE");

    expect(collectKnownWithdrawalRecipients(signer, "mainnet")).toContain(
      signer,
    );
    rememberSuccessfulWithdrawalRecipient(recipient, {
      ensName: "receiver.eth",
      chain: "mainnet",
      label: "receiver",
    });
    expect(loadRecipientHistoryEntries({ chain: "mainnet" })[0]).toMatchObject({
      address: recipient,
      ensName: "receiver.eth",
      label: "receiver",
      source: "withdrawal",
      useCount: 1,
    });
    expect(collectKnownWithdrawalRecipients(null, "mainnet")).toContain(
      recipient,
    );
  });

  test("withSuspendedSpinner stops and restarts active spinners around async work", async () => {
    const calls: string[] = [];
    const spin = {
      isSpinning: true,
      stop: () => {
        calls.push("stop");
      },
      start: () => {
        calls.push("start");
      },
    } as Parameters<typeof withSuspendedSpinner>[0];

    await expect(
      withSuspendedSpinner(spin, async () => {
        calls.push("task");
        return "done";
      }),
    ).resolves.toBe("done");
    expect(calls).toEqual(["stop", "task", "start"]);

    const idleSpin = {
      isSpinning: false,
      stop: () => calls.push("idle-stop"),
      start: () => calls.push("idle-start"),
    } as Parameters<typeof withSuspendedSpinner>[0];
    await expect(
      withSuspendedSpinner(idleSpin, async () => "idle"),
    ).resolves.toBe("idle");
    expect(calls).not.toContain("idle-stop");
    expect(calls).not.toContain("idle-start");
  });

  test("returns an empty list when no Pool Accounts are eligible", () => {
    expect(getEligibleUnapprovedStatuses([], 1n)).toEqual([]);
  });

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

  test("getEligibleUnapprovedStatuses ignores approved-only and insufficient Pool Accounts", () => {
    expect(
      getEligibleUnapprovedStatuses(
        [
          makePoolAccountRef("approved", 15n),
          makePoolAccountRef("pending", 5n, { paNumber: 2, paId: "PA-2" }),
        ],
        10n,
      ),
    ).toEqual([]);
  });

  test("getEligibleUnapprovedStatuses ignores spent and exited Pool Accounts even when funded", () => {
    expect(
      getEligibleUnapprovedStatuses(
        [
          makePoolAccountRef("spent", 50n, { paNumber: 7, paId: "PA-7" }),
          makePoolAccountRef("exited", 75n, { paNumber: 8, paId: "PA-8" }),
        ],
        10n,
      ),
    ).toEqual([]);
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
        status: "unknown",
      }),
    ).toContain(
      "privacy-pools ragequit ETH --chain sepolia --pool-account <PA-#>",
    );

    expect(
      formatApprovalResolutionHint({
        chainName: "sepolia",
        assetSymbol: "ETH",
      }),
    ).toContain("privacy-pools ragequit ETH --chain sepolia --pool-account <PA-#>");
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

    expect(advisory).not.toBeNull();
    expect(advisory?.summary).toContain("PA-3 would keep");
    expect(advisory?.summary).toContain("below the relayer minimum");
    expect(advisory?.choices.join(" ")).toContain("ragequit");
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

  test("validateRelayerQuoteForWithdrawal accepts bigint fee caps and millisecond expirations unchanged", () => {
    expect(
      validateRelayerQuoteForWithdrawal(
        makeQuote({ expiration: 1_710_000_000_000, feeBPS: "50" }),
        500n,
      ),
    ).toEqual({
      quoteFeeBPS: 50n,
      expirationMs: 1_710_000_000_000,
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

  test("refreshExpiredRelayerQuoteForWithdrawal uses default retry settings when omitted", async () => {
    const originalNow = Date.now;
    const retries: Array<[number, number]> = [];

    Date.now = () => 1_000;

    try {
      await expect(
        refreshExpiredRelayerQuoteForWithdrawal({
          fetchQuote: async () => makeQuote({ expiration: 0 }),
          maxRelayFeeBPS: "500",
          onRetry: (attempt, maxAttempts) => retries.push([attempt, maxAttempts]),
        }),
      ).rejects.toThrow("stale/expired quotes repeatedly");
    } finally {
      Date.now = originalNow;
    }

    expect(retries).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });

  test("refreshExpiredRelayerQuoteForWithdrawal surfaces invalid refreshed quotes immediately", async () => {
    let attempts = 0;

    await expect(
      refreshExpiredRelayerQuoteForWithdrawal({
        fetchQuote: async () => {
          attempts += 1;
          return attempts === 1
            ? makeQuote({ expiration: 0 })
            : makeQuote({ feeBPS: "bogus" });
        },
        maxRelayFeeBPS: "500",
        nowMs: () => 1_000,
      }),
    ).rejects.toThrow("malformed feeBPS");

    expect(attempts).toBe(2);
  });

  test("refreshExpiredRelayerQuoteForWithdrawal keeps the first fresh quote and does not invoke onRetry", async () => {
    const retries: number[] = [];

    const result = await refreshExpiredRelayerQuoteForWithdrawal({
      fetchQuote: async () => makeQuote({ expiration: 3_000 }),
      maxRelayFeeBPS: "500",
      nowMs: () => 1_000,
      onRetry: (attempt) => retries.push(attempt),
    });

    expect(result.attempts).toBe(1);
    expect(result.quoteFeeBPS).toBe(50n);
    expect(retries).toEqual([]);
  });

  test("resolveRequestedWithdrawalPoolAccountOrThrow returns the requested actionable Pool Account", () => {
    const requested = makePoolAccountRef("approved", 15n, {
      paNumber: 2,
      paId: "PA-2",
    });

    expect(
      resolveRequestedWithdrawalPoolAccountOrThrow({
        requestedPoolAccounts: [requested],
        allPoolAccounts: [
          makePoolAccountRef("approved", 10n),
          requested,
        ],
        fromPaNumber: 2,
        symbol: "ETH",
        chainName: "mainnet",
      }),
    ).toBe(requested);
  });

  test("resolveRequestedWithdrawalPoolAccountOrThrow fails closed for unavailable historical Pool Accounts", () => {
    expect(() =>
      resolveRequestedWithdrawalPoolAccountOrThrow({
        requestedPoolAccounts: [],
        allPoolAccounts: [
          makePoolAccountRef("spent", 0n, {
            paNumber: 7,
            paId: "PA-7",
          }),
        ],
        fromPaNumber: 7,
        symbol: "ETH",
        chainName: "mainnet",
      }),
    ).toThrow("PA-7 was already fully withdrawn");
  });

  test("resolveRequestedWithdrawalPoolAccountOrThrow reports unknown Pool Accounts with available ids", () => {
    try {
      resolveRequestedWithdrawalPoolAccountOrThrow({
        requestedPoolAccounts: [],
        allPoolAccounts: [
          makePoolAccountRef("approved", 15n),
          makePoolAccountRef("approved", 25n, {
            paNumber: 2,
            paId: "PA-2",
          }),
        ],
        fromPaNumber: 9,
        symbol: "ETH",
        chainName: "mainnet",
      });
      expect.unreachable("expected helper to fail closed");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Unknown Pool Account PA-9 for ETH.",
        hint: expect.stringContaining("Available: PA-1, PA-2."),
      });
    }
  });

  test("resolveRequestedWithdrawalPoolAccountOrThrow still fails closed when a historical Pool Account remains actionable", () => {
    expect(() =>
      resolveRequestedWithdrawalPoolAccountOrThrow({
        requestedPoolAccounts: [],
        allPoolAccounts: [
          makePoolAccountRef("approved", 15n, {
            paNumber: 5,
            paId: "PA-5",
          }),
        ],
        fromPaNumber: 5,
        symbol: "ETH",
        chainName: "mainnet",
      }),
    ).toThrow("Unknown Pool Account PA-5 for ETH.");
  });

  test("resolveRequestedWithdrawalPoolAccountOrThrow surfaces empty-state unknown selectors cleanly", () => {
    expect(() =>
      resolveRequestedWithdrawalPoolAccountOrThrow({
        requestedPoolAccounts: [],
        allPoolAccounts: [],
        fromPaNumber: 4,
        symbol: "ETH",
        chainName: "mainnet",
      }),
    ).toThrow("Unknown Pool Account PA-4 for ETH.");
  });
});
