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
  confirmPromptMock,
  fakeCommand,
  fetchMerkleLeavesMock,
  getRelayerDetailsMock,
  handleWithdrawCommand,
  inputPromptMock,
  listPoolsMock,
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

}
