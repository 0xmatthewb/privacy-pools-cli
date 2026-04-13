import { expect, mock, test } from "bun:test";
import {
  APPROVED_POOL_ACCOUNT,
  CHAINS,
  DEFAULT_RELAYER_RECIPIENT,
  ETH_POOL,
  buildRelayerQuote,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  encodeRelayerWithdrawalData,
  expectPrintedRawTransactions,
  expectUnsignedTransactions,
  fakeCommand,
  getPublicClientMock,
  getRelayerDetailsMock,
  handleWithdrawCommand,
  initializeAccountServiceMock,
  printRawTransactionsMock,
  proveWithdrawalMock,
  requestQuoteMock,
  saveAccountMock,
  saveSyncMetaMock,
  submitRelayRequestMock,
  useIsolatedHome,
} from "./withdraw-command-handler.shared.ts";

export function registerWithdrawRelayedPreludeTests(): void {
  test("renders a relayed JSON dry-run with quote and anonymity metadata", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("relayed");
    expect(json.dryRun).toBe(true);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.feeBPS).toBe("250");
    expect(json.anonymitySet).toEqual(
      expect.objectContaining({
        eligible: 8,
        total: 12,
      }),
    );
  });

}
export function registerWithdrawRelayedUnsignedAndSubmitTests(): void {
  test("builds an unsigned relayed withdrawal with the relayer request envelope", async () => {
    useIsolatedHome({ withSigner: true });

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          unsigned: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("unsigned");
    expect(json.withdrawMode).toBe("relayed");
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.feeBPS).toBe("250");
    expect(json.relayerRequest).toEqual(
      expect.objectContaining({
        feeCommitment: expect.objectContaining({
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
        }),
      }),
    );
    expectUnsignedTransactions(json.transactions, [
      {
        chainId: 1,
        from: null,
        to: CHAINS.mainnet.entrypoint,
        value: "0",
        description: "Relay withdrawal through Entrypoint",
      },
    ]);
  });

  test("prints raw unsigned relayed withdrawal transactions when --unsigned tx is requested", async () => {
    useIsolatedHome({ withSigner: true });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          unsigned: "tx",
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(submitRelayRequestMock).not.toHaveBeenCalled();
    expectPrintedRawTransactions(printRawTransactionsMock, [
      {
        chainId: 1,
        to: CHAINS.mainnet.entrypoint,
        value: "0",
        description: "Relay withdrawal through Entrypoint",
      },
    ]);
  });

  test("prints raw unsigned transactions when --unsigned tx is requested", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: "tx",
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expectPrintedRawTransactions(printRawTransactionsMock, [
      {
        chainId: 1,
        to: ETH_POOL.pool,
        value: "0",
        description: "Direct withdraw from Privacy Pool",
      },
    ]);
  });

  test("submits a relayed withdrawal and persists the updated commitment state", async () => {
    useIsolatedHome({ withSigner: true });
    const addWithdrawalCommitmentMock = mock(() => undefined);
    initializeAccountServiceMock.mockImplementationOnce(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () =>
        new Map([[1n, [APPROVED_POOL_ACCOUNT.commitment]]]),
      createWithdrawalSecrets: () => ({
        nullifier: 901n,
        secret: 902n,
      }),
      addWithdrawalCommitment: addWithdrawalCommitmentMock,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x6666666666666666666666666666666666666666",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("relayed");
    expect(json.txHash).toBe("0x" + "34".repeat(32));
    expect(addWithdrawalCommitmentMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
  });

}
export function registerWithdrawRelayedMidCompletionTests(): void {
  test("fails closed when the relayer omits fee commitment details", async () => {
    useIsolatedHome({ withSigner: true });
    requestQuoteMock.mockImplementationOnce(async () => ({
      baseFeeBPS: "200",
      feeBPS: "250",
      gasPrice: "1",
      detail: { relayTxCost: { gas: "0", eth: "0" } },
      feeCommitment: null,
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RELAYER_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "missing required fee details",
    );
    expect(exitCode).toBe(5);
  });

  test("uses the relayer-signed withdrawal data even when relayer details disagree", async () => {
    useIsolatedHome({ withSigner: true });
    const signedFeeReceiver =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "10000000000000000",
      feeReceiverAddress:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address,
      relayerUrl: "https://details-relayer.test",
    }));
    requestQuoteMock.mockImplementationOnce(async (_chainConfig, params) =>
      buildRelayerQuote({
        recipient: params?.recipient,
        feeRecipient: signedFeeReceiver,
        relayerUrl: params?.relayerUrl,
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: DEFAULT_RELAYER_RECIPIENT,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relayerUrl: "https://details-relayer.test",
      }),
    );
    expect(submitRelayRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relayerUrl: "https://details-relayer.test",
        withdrawal: expect.objectContaining({
          data: encodeRelayerWithdrawalData({
            recipient: DEFAULT_RELAYER_RECIPIENT,
            feeRecipient: signedFeeReceiver,
            relayFeeBPS: 250n,
          }),
        }),
      }),
    );
  });

  test("fails closed when relayer withdrawal data targets a different recipient", async () => {
    useIsolatedHome({ withSigner: true });
    requestQuoteMock.mockImplementationOnce(async () =>
      buildRelayerQuote({
        recipient: "0x5555555555555555555555555555555555555555" as Address,
      }),
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: DEFAULT_RELAYER_RECIPIENT,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RELAYER_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "recipient does not match",
    );
    expect(exitCode).toBe(5);
  });

}
export function registerWithdrawRelayedQuoteRefreshPreludeTests(): void {
  test("refreshes an expired machine-mode relayer quote before building the proof", async () => {
    useIsolatedHome({ withSigner: true });
    requestQuoteMock
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: 946684800 }),
      )
      .mockImplementationOnce(async () =>
        buildRelayerQuote(),
      );

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(json.quoteExpiresAt).toContain("2100");
  });

}
export function registerWithdrawRelayedFailureAndTimeoutTests(): void {
  test("fails closed when the relayed withdrawal transaction reverts onchain", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => 1n,
      waitForTransactionReceipt: async () => ({
        status: "reverted",
        blockNumber: 456n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("CONTRACT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Relay transaction reverted",
    );
    expect(exitCode).toBe(7);
  });

  test("fails closed when waiting for the relayed withdrawal confirmation times out", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => 1n,
      waitForTransactionReceipt: async () => {
        throw new Error("timeout");
      },
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Timed out waiting for relayed withdrawal confirmation",
    );
    expect(exitCode).toBe(3);
  });

}
export function registerWithdrawRelayedQuoteRefreshTests(): void {
  test("auto-refreshes an expired relayer quote after proof generation when the fee is unchanged", async () => {
    useIsolatedHome({ withSigner: true });
    const originalNow = Date.now;
    let nowCalls = 0;
    const initialNow = 1_700_000_000_000;
    const expiredNow = 1_700_000_003_000;
    proveWithdrawalMock.mockImplementationOnce(async () => {
      return {
        proof: {
          pi_a: ["0", "0", "1"],
          pi_b: [
            ["0", "0"],
            ["0", "0"],
            ["1", "0"],
          ],
          pi_c: ["0", "0", "1"],
        },
        publicSignals: [1n, 2n, 3n],
      };
    });
    requestQuoteMock
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: initialNow + 1_000 }),
      )
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: initialNow + 10_000 }),
      );
    Date.now = () => (++nowCalls <= 2 ? initialNow : expiredNow);

    try {
      const { json } = await captureAsyncJsonOutput(() =>
        handleWithdrawCommand(
          "0.1",
          "ETH",
          {
            to: "0x4444444444444444444444444444444444444444",
          },
          fakeCommand({ json: true, chain: "mainnet" }),
        ),
      );

      expect(json.success).toBe(true);
      expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalNow;
    }
  });

  test("fails closed when the relayer fee changes after proof generation", async () => {
    useIsolatedHome({ withSigner: true });
    const originalNow = Date.now;
    let nowCalls = 0;
    const initialNow = 1_700_000_000_000;
    // Quote expires 31s in the future so the pre-proof freshness check (< 30s)
    // does NOT trigger proactively. The expiry only fires post-proof.
    const quoteExpiresAt = initialNow + 31_000;
    const expiredNow = quoteExpiresAt + 1_000;
    proveWithdrawalMock.mockImplementationOnce(async () => {
      return {
        proof: {
          pi_a: ["0", "0", "1"],
          pi_b: [
            ["0", "0"],
            ["0", "0"],
            ["1", "0"],
          ],
          pi_c: ["0", "0", "1"],
        },
        publicSignals: [1n, 2n, 3n],
      };
    });
    requestQuoteMock
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: quoteExpiresAt }),
      )
      .mockImplementationOnce(async () =>
        buildRelayerQuote({
          feeBPS: "275",
          expiration: initialNow + 100_000,
          signedRelayerCommitment: "0x02",
        }),
      );
    // First few calls return initialNow (quote is valid), then expiredNow (post-proof expired).
    Date.now = () => (++nowCalls <= 4 ? initialNow : expiredNow);

    try {
      const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        handleWithdrawCommand(
          "0.1",
          "ETH",
          {
            to: "0x4444444444444444444444444444444444444444",
          },
          fakeCommand({ json: true, chain: "mainnet" }),
        ),
      );

      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("RELAYER_ERROR");
      expect(json.error.message ?? json.errorMessage).toContain(
        "Relayer fee changed during proof generation",
      );
      expect(exitCode).toBe(5);
    } finally {
      Date.now = originalNow;
    }
  });

  test("fails closed when the relayer withdrawal data changes after proof generation", async () => {
    useIsolatedHome({ withSigner: true });
    const originalNow = Date.now;
    let nowCalls = 0;
    const initialNow = 1_700_000_000_000;
    // Quote expires 31s in the future so the pre-proof freshness check (< 30s)
    // does NOT trigger proactively. The expiry only fires post-proof.
    const quoteExpiresAt = initialNow + 31_000;
    const expiredNow = quoteExpiresAt + 1_000;
    requestQuoteMock
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: quoteExpiresAt }),
      )
      .mockImplementationOnce(async () =>
        buildRelayerQuote({
          expiration: initialNow + 100_000,
          feeRecipient:
            "0x9999999999999999999999999999999999999999" as Address,
        }),
      );
    // First few calls return initialNow (quote is valid), then expiredNow (post-proof expired).
    Date.now = () => (++nowCalls <= 4 ? initialNow : expiredNow);

    try {
      const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        handleWithdrawCommand(
          "0.1",
          "ETH",
          {
            to: DEFAULT_RELAYER_RECIPIENT,
          },
          fakeCommand({ json: true, chain: "mainnet" }),
        ),
      );

      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("RELAYER_ERROR");
      expect(json.error.message ?? json.errorMessage).toContain(
        "withdrawal data changed during proof generation",
      );
      expect(exitCode).toBe(5);
    } finally {
      Date.now = originalNow;
    }
  });
}
