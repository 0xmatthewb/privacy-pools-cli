import { expect, test } from "bun:test";
import {
  APPROVED_POOL_ACCOUNT,
  CLIError,
  DEFAULT_RELAYER_FEE_RECEIVER,
  ETH_POOL,
  USDC_POOL,
  buildAllPoolAccountRefsMock,
  buildLoadedAspDepositReviewStateMock,
  buildPoolAccountRefsMock,
  buildRelayerQuote,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
  confirmPromptMock,
  fakeCommand,
  fetchMerkleLeavesMock,
  getRelayerDetailsMock,
  handleWithdrawCommand,
  inputPromptMock,
  isPromptCancellationErrorMock,
  listPoolsMock,
  maybeRecoverMissingWalletSetupMock,
  maybeRenderPreviewScenarioMock,
  proveWithdrawalMock,
  requestQuoteMock,
  resolvePoolMock,
  saveAccountMock,
  selectPromptMock,
  submitRelayRequestMock,
  useIsolatedHome,
  withdrawDirectMock,
} from "./withdraw-command-handler.shared.ts";

export function registerWithdrawInteractiveReviewTests(): void {
  test("prompts for the amount in human mode and validates inline amount input", async () => {
    useIsolatedHome({ withSigner: true });
    inputPromptMock.mockImplementationOnce(async (options?: { validate?: (value: string) => true | string }) => {
      expect(options?.validate?.("")).toBe("Enter an amount or percentage.");
      expect(options?.validate?.("0%")).toBe("Use a percentage between 1% and 100%.");
      expect(options?.validate?.("50%")).toBe(true);
      expect(options?.validate?.("-1")).toContain("must be greater than zero");
      expect(options?.validate?.("0.1")).toBe(true);
      return "0.5";
    });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        undefined,
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Withdrawal review");
    expect(stderr).toContain("Withdrawal cancelled.");
  });

  test("prompts for the recipient in human relayed mode when --to is omitted", async () => {
    useIsolatedHome({ withSigner: true });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(inputPromptMock).toHaveBeenCalledTimes(1);
    expect(confirmPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Withdrawal review");
    expect(stderr).toContain("0x4444");
  });

  test("returns early when preview rendering takes over recipient capture", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey: string) =>
      commandKey === "withdraw recipient input"
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(inputPromptMock).not.toHaveBeenCalled();
    expect(submitRelayRequestMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over recipient capture after Pool Account selection", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string, options?: { timing?: string }) =>
        commandKey === "withdraw recipient input" && options?.timing === "after-prompts",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using relayed withdrawal");
    expect(inputPromptMock).not.toHaveBeenCalled();
    expect(submitRelayRequestMock).not.toHaveBeenCalled();
  });

  test("prompts for the recipient only after asset and pool-account selection", async () => {
    useIsolatedHome({ withSigner: true });
    const alternateApproved = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 503n,
        label: 603n,
        value: 2000000000000000000n,
      },
      label: 603n,
      value: 2000000000000000000n,
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      alternateApproved,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      alternateApproved,
    ]);
    fetchMerkleLeavesMock.mockImplementation(async () => ({
      aspLeaves: ["601", "603"],
      stateTreeLeaves: ["501", "503"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementation(() => ({
      approvedLabels: new Set<string>(["601", "603"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["603", "approved"],
      ]),
    }));

    const events: string[] = [];
    selectPromptMock
      .mockImplementationOnce(async () => {
        events.push("asset");
        return ETH_POOL.asset;
      })
      .mockImplementationOnce(async () => {
        events.push("pool-account");
        return 3;
      });
    inputPromptMock.mockImplementationOnce(async () => {
      events.push("recipient");
      return "0x4444444444444444444444444444444444444444";
    });
    confirmPromptMock.mockImplementationOnce(async () => {
      events.push("confirm");
      return true;
    });

    await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(events).toEqual([
      "asset",
      "pool-account",
      "recipient",
      "confirm",
    ]);
  });

  test("prompts for asset, amount, recipient, and confirmation in that order", async () => {
    useIsolatedHome({ withSigner: true });
    const events: string[] = [];

    selectPromptMock.mockImplementationOnce(async () => {
      events.push("asset");
      return ETH_POOL.asset;
    });
    inputPromptMock
      .mockImplementationOnce(async (options?: { validate?: (value: string) => true | string }) => {
        events.push("amount");
        expect(options?.validate?.("")).toBe("Enter an amount or percentage.");
        expect(options?.validate?.("50%")).toBe(true);
        return "0.1";
      })
      .mockImplementationOnce(async (options?: { validate?: (value: string) => true | string }) => {
        events.push("recipient");
        expect(options?.validate?.("not-an-address")).toContain(
          "Recipient is not a valid Ethereum address",
        );
        return "0x4444444444444444444444444444444444444444";
      });
    confirmPromptMock.mockImplementationOnce(async () => {
      events.push("confirm");
      return false;
    });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(listPoolsMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["asset", "amount", "recipient", "confirm"]);
    expect(stderr).toContain("Withdrawal review");
    expect(stderr).toContain("Withdrawal cancelled.");
  });

  test("lets humans choose among multiple approved Pool Accounts", async () => {
    useIsolatedHome({ withSigner: true });
    const alternateApproved = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 503n,
        label: 603n,
        value: 2000000000000000000n,
      },
      label: 603n,
      value: 2000000000000000000n,
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      alternateApproved,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      alternateApproved,
    ]);
    fetchMerkleLeavesMock.mockImplementation(async () => ({
      aspLeaves: ["601", "603"],
      stateTreeLeaves: ["501", "503"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementation(() => ({
      approvedLabels: new Set<string>(["601", "603"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["603", "approved"],
      ]),
    }));
    selectPromptMock.mockImplementationOnce(async () => 3);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("PA-3");
  });

  test("allows humans to cancel a direct withdrawal after the privacy warning", async () => {
    useIsolatedHome({ withSigner: true });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("NOT privacy-preserving");
    expect(stderr).toContain("Withdrawal cancelled.");
    expect(proveWithdrawalMock).not.toHaveBeenCalled();
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("refreshes expired human quotes before proceeding with the withdrawal review", async () => {
    useIsolatedHome({ withSigner: true });
    requestQuoteMock
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: 946684800 }),
      )
      .mockImplementationOnce(async () =>
        buildRelayerQuote(),
      );

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(stderr).toContain("Withdrawal review");
  });

  test("continues after a non-fatal early relayer-details fetch failure and logs it in verbose mode", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock
      .mockImplementationOnce(async () => {
        throw new Error("temporary relayer outage");
      })
      .mockImplementationOnce(async () => ({
        minWithdrawAmount: "10000000000000000",
        feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
        relayerUrl: "https://fastrelay.xyz",
      }));
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet", verbose: true }),
      ),
    );

    expect(stderr).toContain("Early relayer details fetch failed (non-fatal)");
    expect(stderr).toContain("Withdrawal cancelled.");
  });

  test("treats early relayer-details prompt cancellations as clean human aborts", async () => {
    useIsolatedHome({ withSigner: true });
    const cancelled = new Error("cancelled");
    getRelayerDetailsMock.mockImplementationOnce(async () => {
      throw cancelled;
    });
    isPromptCancellationErrorMock.mockImplementation(
      (error: unknown) => error === cancelled,
    );

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Operation cancelled.");
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("treats below-minimum amount prompt cancellations as clean human aborts", async () => {
    useIsolatedHome({ withSigner: true });
    const cancelled = new Error("cancelled");
    inputPromptMock.mockImplementationOnce(async () => {
      throw cancelled;
    });
    isPromptCancellationErrorMock.mockImplementation(
      (error: unknown) => error === cancelled,
    );

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.001",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain("below the relayer minimum");
    expect(stderr).toContain("Operation cancelled.");
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("validates prompted recipient addresses before rendering the relayed review", async () => {
    useIsolatedHome({ withSigner: true });
    inputPromptMock.mockImplementationOnce(async (options?: { validate?: (value: string) => true | string }) => {
      expect(options?.validate?.("not-an-address")).toContain(
        "Recipient is not a valid Ethereum address",
      );
      expect(options?.validate?.("0x4444444444444444444444444444444444444444")).toBe(true);
      return "0x4444444444444444444444444444444444444444";
    });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Withdrawal review");
    expect(stderr).toContain("0x4444");
  });

  test("warns humans when --extra-gas is requested for native withdrawals", async () => {
    useIsolatedHome({ withSigner: true });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
          extraGas: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain(
      "Extra gas is not applicable for native-asset withdrawals",
    );
    expect(stderr).toContain("Withdrawal cancelled.");
  });

  test("downgrades unsupported extra gas requests before human relayed withdrawal review", async () => {
    useIsolatedHome({ withSigner: true });
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "1000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
    }));
    requestQuoteMock
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params?.extraGas).toBe(true);
        throw new CLIError(
          "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
          "RELAYER",
          "UNSUPPORTED_FEATURE",
        );
      })
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params?.extraGas).toBe(false);
        return buildRelayerQuote({
          recipient: params?.recipient,
          asset: USDC_POOL.asset,
          amount: params?.amount?.toString(),
          extraGas: false,
        });
      });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "100",
        "USDC",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(stderr).toContain("Continuing without it.");
    expect(stderr).toContain("Withdrawal cancelled.");
  });

  test("warns humans when an expired quote refresh downgrades extra gas support", async () => {
    useIsolatedHome({ withSigner: true });
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "1000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
      relayerUrl: "https://fastrelay.xyz",
    }));
    requestQuoteMock
      .mockImplementationOnce(async (_chainConfig, params) =>
        buildRelayerQuote({
          recipient: params?.recipient,
          asset: USDC_POOL.asset,
          amount: params?.amount?.toString(),
          extraGas: true,
          expiration: 946684800,
        }),
      )
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params?.extraGas).toBe(true);
        throw new CLIError(
          "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
          "RELAYER",
          "UNSUPPORTED_FEATURE",
        );
      })
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params?.extraGas).toBe(false);
        return buildRelayerQuote({
          recipient: params?.recipient,
          asset: USDC_POOL.asset,
          amount: params?.amount?.toString(),
          extraGas: false,
        });
      });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "100",
        "USDC",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledTimes(3);
    expect(stderr).toContain("Continuing without it.");
    expect(stderr).toContain("Withdrawal review");
  });

  test("shows extra gas funding details during human relayed withdrawal review", async () => {
    useIsolatedHome({ withSigner: true });
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "1000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
    }));
    requestQuoteMock.mockImplementationOnce(async (_chainConfig, params) => ({
      ...buildRelayerQuote({
        recipient: params?.recipient,
        asset: USDC_POOL.asset,
        amount: params?.amount?.toString(),
        extraGas: true,
      }),
      detail: {
        relayTxCost: { gas: "0", eth: "0" },
        extraGasFundAmount: { eth: "1000000000000000" },
      },
    }));
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "100",
        "USDC",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Gas token received:");
    expect(stderr).not.toContain("Gas token drop");
    expect(stderr).toContain("Withdrawal cancelled.");
  });

}
export function registerWithdrawInteractiveAssetSelectionTests(): void {
  test("prompts humans to choose an asset when it is omitted", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => ETH_POOL.asset);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(listPoolsMock).toHaveBeenCalledTimes(1);
    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Selected PA-1");
  });

  test("interactive asset selection re-resolves the chosen pool before quoting", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementationOnce(async () => [
      {
        ...USDC_POOL,
        asset: "0x9999999999999999999999999999999999999999",
      },
    ]);
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
    selectPromptMock.mockImplementationOnce(async () => USDC_POOL.asset);

    await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "100",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(resolvePoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet", id: 1 }),
      USDC_POOL.asset,
      undefined,
    );
  });

}
export function registerWithdrawInteractiveCompletionTests(): void {
  test("lets humans revise below-minimum withdrawals and validates the new amount", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "500000000000000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
      relayerUrl: "https://fastrelay.xyz",
    }));
    inputPromptMock.mockImplementationOnce(async (options?: { validate?: (value: string) => true | string }) => {
      expect(options?.validate?.("oops")).toContain("Invalid amount");
      expect(options?.validate?.("0.1")).toContain("at least 0.5 ETH");
      expect(options?.validate?.("2")).toContain("Amount exceeds PA-1 balance");
      expect(options?.validate?.("0.6")).toBe(true);
      return "0.6";
    });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Withdrawal amount 0.1 ETH is below the relayer minimum");
    expect(stderr).toContain("Updated withdrawal amount: 0.6 ETH");
    expect(stderr).toContain("Withdrawal cancelled.");
  });

  test("warns human relayed withdrawals when the remainder falls below the relayer minimum", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "50000000000000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
    }));

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.96",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ yes: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("below the relayer minimum");
    expect(submitRelayRequestMock).toHaveBeenCalled();
  });

  test("lets humans switch to the full balance when the remainder would be stranded", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "50000000000000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
      relayerUrl: "https://fastrelay.xyz",
    }));
    selectPromptMock.mockImplementationOnce(async () => "max");
    inputPromptMock.mockImplementationOnce(async () => "1 ETH");

    await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.96",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: 1000000000000000000n,
      }),
    );
    expect(submitRelayRequestMock).toHaveBeenCalled();
  });

  test("lets humans continue with a stranded remainder after the advisory prompt", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "50000000000000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
      relayerUrl: "https://fastrelay.xyz",
    }));
    selectPromptMock.mockImplementationOnce(async () => "continue");
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.96",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: 960000000000000000n,
      }),
    );
    expect(stderr).toContain("Remaining balance (0.04 ETH) would fall below the relayer minimum.");
    expect(stderr).toContain("Withdrawal cancelled.");
  });

  test("uses the high-stakes typed confirmation path for full-balance human relayed withdrawals", async () => {
    useIsolatedHome({ withSigner: true });
    inputPromptMock.mockImplementationOnce(async () => "1 ETH");

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "ETH",
        undefined,
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain(
      "Double-check the amount and destination before continuing.",
    );
    expect(submitRelayRequestMock).toHaveBeenCalled();
  });

  test("refreshes the relayer quote again when it expires during human confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    const originalNow = Date.now;
    let nowCalls = 0;
    const initialNow = 1_700_000_000_000;
    const quoteExpiresAt = initialNow + 31_000;
    const expiredNow = quoteExpiresAt + 1_000;
    requestQuoteMock
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: quoteExpiresAt }),
      )
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: initialNow + 100_000 }),
      );
    confirmPromptMock
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => true);
    Date.now = () => (++nowCalls <= 2 ? initialNow : expiredNow);

    try {
      const { stderr } = await captureAsyncOutput(() =>
        handleWithdrawCommand(
          "0.1",
          "ETH",
          {
            to: "0x4444444444444444444444444444444444444444",
          },
          fakeCommand({ chain: "mainnet" }),
        ),
      );

      expect(requestQuoteMock).toHaveBeenCalledTimes(2);
      expect(stderr).toContain(
        "Quote expired while you were confirming. Fetching a fresh relayer quote",
      );
      expect(submitRelayRequestMock).toHaveBeenCalled();
    } finally {
      Date.now = originalNow;
    }
  });

  test("prints relayed save warnings for human callers after onchain confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    saveAccountMock.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ yes: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Relayed withdrawal confirmed onchain but failed to save locally");
    expect(stderr).toContain("privacy-pools sync");
  });

  test("treats prompt cancellations as clean human aborts", async () => {
    useIsolatedHome({ withSigner: true });
    const error = new Error("cancelled") as Error & { name: string };
    error.name = "AbortPromptError";
    inputPromptMock.mockImplementationOnce(async () => {
      throw error;
    });
    isPromptCancellationErrorMock.mockImplementation(
      (candidate: unknown) => candidate === error,
    );

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Operation cancelled.");
  });

  test("returns cleanly when missing wallet setup is recovered by the helper", async () => {
    useIsolatedHome();
    maybeRecoverMissingWalletSetupMock.mockImplementationOnce(async () => true);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("NOT privacy-preserving");
    expect(stderr).not.toContain("Error [");
  });

  test("returns early when preview rendering takes over a later relayed confirmation step", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey: string) =>
      commandKey === "withdraw confirm"
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(submitRelayRequestMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over relayed confirmation after rendering the review", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string, options?: { timing?: string }) =>
        commandKey === "withdraw confirm" && options?.timing === "after-prompts",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrawal review");
    expect(submitRelayRequestMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over direct withdrawal confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey: string) =>
      commandKey === "withdraw direct confirm"
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("NOT privacy-preserving");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over direct confirmation after rendering the review", async () => {
    useIsolatedHome({ withSigner: true });
    let directConfirmPreviewCalls = 0;
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string, options?: { timing?: string }) => {
        if (
          commandKey === "withdraw direct confirm" &&
          options?.timing === "after-prompts"
        ) {
          directConfirmPreviewCalls += 1;
          return directConfirmPreviewCalls === 2;
        }
        return false;
      },
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Direct withdrawal review");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

}
