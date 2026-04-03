import { expect, mock, test } from "bun:test";
import {
  APPROVED_POOL_ACCOUNT,
  CHAINS,
  CLIError,
  DEFAULT_RELAYER_FEE_RECEIVER,
  DEFAULT_RELAYER_RECIPIENT,
  ETH_POOL,
  OP_SEPOLIA_WETH_POOL,
  PENDING_POOL_ACCOUNT,
  USDC_POOL,
  acquireProcessLockMock,
  buildAllPoolAccountRefsMock,
  buildLoadedAspDepositReviewStateMock,
  buildPoolAccountRefsMock,
  buildRelayerQuote,
  calculateContextMock,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
  checkHasGasMock,
  collectActiveLabelsMock,
  confirmPromptMock,
  describeUnavailablePoolAccountMock,
  encodeRelayerWithdrawalData,
  expectPrintedRawTransactions,
  expectUnsignedTransactions,
  fakeCommand,
  fakeQuoteCommand,
  fetchDepositReviewStatusesMock,
  fetchDepositsLargerThanMock,
  fetchMerkleLeavesMock,
  fetchMerkleRootsMock,
  generateMerkleProofMock,
  getDataServiceMock,
  getPublicClientMock,
  getRelayerDetailsMock,
  getUnknownPoolAccountErrorMock,
  guardCriticalSectionMock,
  handleWithdrawCommand,
  handleWithdrawQuoteCommand,
  initializeAccountServiceMock,
  inputPromptMock,
  listPoolsMock,
  parsePoolAccountSelectorMock,
  printRawTransactionsMock,
  proveWithdrawalMock,
  registerWithdrawCommandHandlerHarness,
  releaseCriticalSectionMock,
  requestQuoteMock,
  resolvePoolMock,
  saveAccountMock,
  saveSyncMetaMock,
  selectPromptMock,
  stringifyBigIntsMock,
  submitRelayRequestMock,
  toWithdrawSolidityProofMock,
  useIsolatedHome,
  withdrawDirectMock,
} from "./withdraw-command-handler.shared.ts";

export { registerWithdrawCommandHandlerHarness } from "./withdraw-command-handler.shared.ts";

export function registerWithdrawValidationPreludeTests(): void {
  test("rejects malformed --from-pa selectors before touching account state", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "banana",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Invalid --from-pa");
    expect(exitCode).toBe(2);
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("fails closed in machine mode when no withdrawal amount is supplied", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Missing amount");
    expect(exitCode).toBe(2);
  });

  test("fails cleanly for humans when no pools are available to choose from", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementationOnce(async () => []);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(2);
    expect(stderr).toContain("No pools found on mainnet");
  });

}

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

export function registerWithdrawDirectPreludeTests(): void {
  test("builds an unsigned direct withdrawal without touching signer state", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("unsigned");
    expect(json.withdrawMode).toBe("direct");
    expect(json.poolAccountId).toBe("PA-1");
    expectUnsignedTransactions(json.transactions, [
      {
        chainId: 1,
        from: "0x5555555555555555555555555555555555555555",
        to: ETH_POOL.pool,
        value: "0",
        description: "Direct withdraw from Privacy Pool",
      },
    ]);
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

export function registerWithdrawDirectUnsignedAndSubmitTests(): void {
  test("submits a direct withdrawal to the signer address when requested", async () => {
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
          direct: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("direct");
    expect(json.txHash).toBe("0x" + "56".repeat(32));
    expect(addWithdrawalCommitmentMock).toHaveBeenCalledTimes(1);
  });

}

export function registerWithdrawValidationAccountSelectionTests(): void {
  test("resolves --all withdrawals to the full selected Pool Account balance", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "ETH",
        undefined,
        {
          all: true,
          dryRun: true,
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.amount).toBe("1000000000000000000");
    expect(json.poolAccountId).toBe("PA-1");
  });

  test("resolves percentage withdrawals against the selected Pool Account balance", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "50%",
        "ETH",
        {
          dryRun: true,
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.amount).toBe("500000000000000000");
    expect(json.poolAccountId).toBe("PA-1");
  });

  test("fails closed when --all is combined with a positional amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "ETH",
        "0.1",
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Cannot specify an amount with --all");
    expect(exitCode).toBe(2);
  });

  test("fails closed in machine mode when no asset is supplied", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No asset specified",
    );
    expect(exitCode).toBe(2);
  });

  test("requires an explicit recipient for direct unsigned withdrawals", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Direct withdrawal requires --to");
    expect(exitCode).toBe(2);
  });

  test("rejects direct withdrawals whose recipient does not match the signer", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          to: "0x9999999999999999999999999999999999999999",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("must match your signer address");
    expect(exitCode).toBe(2);
  });

  test("rejects Pool Accounts that cannot cover the requested amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "2",
        "ETH",
        {
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No Pool Account has enough balance",
    );
    expect(exitCode).toBe(2);
  });

  test("surfaces ACCOUNT_NOT_APPROVED when the selected Pool Account is still pending", async () => {
    useIsolatedHome({ withSigner: true });
    buildPoolAccountRefsMock.mockImplementationOnce(() => [PENDING_POOL_ACCOUNT]);
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [PENDING_POOL_ACCOUNT]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: [],
      stateTreeLeaves: ["502"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(),
      reviewStatuses: new Map<string, string>([["602", "pending"]]),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "PA-2",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(json.error.hint).toContain("accounts --chain mainnet");
    expect(exitCode).toBe(4);
  });

  test("surfaces unavailable historical Pool Accounts through --from-pa", async () => {
    useIsolatedHome({ withSigner: true });
    const spentPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      status: "spent",
      aspStatus: "approved",
      value: 0n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 503n,
        label: 603n,
        value: 0n,
      },
      label: 603n,
    };
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [
      APPROVED_POOL_ACCOUNT,
      spentPoolAccount,
    ]);
    describeUnavailablePoolAccountMock.mockImplementationOnce(
      () => "PA-3 has already been spent and has no remaining balance.",
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "PA-3",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("already been spent");
    expect(json.error.hint).toContain("inspect PA-3");
    expect(exitCode).toBe(2);
  });

  test("surfaces unknown Pool Accounts through --from-pa", async () => {
    useIsolatedHome({ withSigner: true });
    getUnknownPoolAccountErrorMock.mockImplementationOnce(() => ({
      message: "PA-99 is not part of this pool.",
      hint: "Choose an existing Pool Account from privacy-pools accounts.",
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "PA-99",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("PA-99 is not part of this pool");
    expect(json.error.hint).toContain("privacy-pools accounts");
    expect(exitCode).toBe(2);
  });

  test("rejects explicitly selected Pool Accounts that cannot cover the requested amount", async () => {
    useIsolatedHome({ withSigner: true });
    const largerApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 4,
      paId: "PA-4",
      value: 3000000000000000000n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 504n,
        label: 604n,
        value: 3000000000000000000n,
      },
      label: 604n,
      txHash: "0x" + "cc".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["601", "604"],
      stateTreeLeaves: ["501", "504"],
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "2",
        "ETH",
        {
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "PA-1 has insufficient balance",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when the relayer minimum exceeds the requested amount", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "9000000000000000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
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
    expect(json.error.message ?? json.errorMessage).toContain("below relayer minimum");
    expect(exitCode).toBe(5);
  });

  test("fails closed when ASP roots are still converging", async () => {
    useIsolatedHome({ withSigner: true });
    fetchMerkleRootsMock.mockImplementationOnce(async () => ({
      mtRoot: "1",
      onchainMtRoot: "2",
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
    expect(json.errorCode).toBe("ASP_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("still updating");
    expect(exitCode).toBe(4);
  });

  test("fails closed when ASP root parity drifts from the onchain latest root", async () => {
    useIsolatedHome({ withSigner: true });
    fetchMerkleRootsMock.mockImplementationOnce(async () => ({
      mtRoot: "1",
      onchainMtRoot: "1",
    }));
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "latestRoot" ? 2n : 1n,
      waitForTransactionReceipt: async () => ({
        status: "success",
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
    expect(json.errorCode).toBe("ASP_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "out of sync with the chain",
    );
    expect(exitCode).toBe(4);
  });

}

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
    expect(stderr).toContain("Withdrawal Review");
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
        return "ETH";
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
    expect(stderr).toContain("Withdrawal Review");
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

export function registerWithdrawQuoteTests(): void {
  test("returns a structured relayer quote in JSON mode", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {
          to: "0x7777777777777777777777777777777777777777",
        },
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("relayed-quote");
    expect(json.asset).toBe("ETH");
    expect(json.quoteFeeBPS).toBe("250");
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "withdraw",
          when: "after_quote",
        }),
      ]),
    );
  });

  test("quote returns a template follow-up when no recipient is supplied", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.recipient).toBeNull();
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "withdraw",
          runnable: false,
        }),
      ]),
    );
  });

  test("quote fails closed when no asset is supplied", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No asset specified",
    );
    expect(exitCode).toBe(2);
  });

  test("quote inherits parent withdraw flags and suppresses extra gas for native assets", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand(
          { chain: "mainnet" },
          {
            asset: "ETH",
            to: "0x7777777777777777777777777777777777777777",
            extraGas: true,
          },
        ),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Extra gas is not applicable for native-asset withdrawals",
    );
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asset: ETH_POOL.asset,
        extraGas: false,
        recipient: "0x7777777777777777777777777777777777777777",
      }),
    );
  });

  test("quote suppresses extra gas for op-sepolia WETH native-ux withdrawals", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => OP_SEPOLIA_WETH_POOL);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand(
          { chain: "op-sepolia" },
          {
            asset: "WETH",
            to: "0x7777777777777777777777777777777777777777",
            extraGas: true,
          },
        ),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Extra gas is not applicable for native-asset withdrawals",
    );
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asset: OP_SEPOLIA_WETH_POOL.asset,
        extraGas: false,
        recipient: "0x7777777777777777777777777777777777777777",
      }),
    );
  });

  test("quote keeps feeCommitmentPresent false when the relayer omits fee commitment details", async () => {
    useIsolatedHome();
    requestQuoteMock.mockImplementationOnce(async () => ({
      baseFeeBPS: "200",
      feeBPS: "250",
      gasPrice: "1",
      detail: { relayTxCost: { gas: "0", eth: "0" } },
      feeCommitment: null,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.feeCommitmentPresent).toBe(false);
    expect(json.quoteExpiresAt).toBeNull();
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relayerUrl: "https://fastrelay.xyz",
      }),
    );
  });

  test("quote downgrades unsupported extra gas requests and keeps the result machine-readable", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
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

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "100",
        "USDC",
        {
          to: "0x7777777777777777777777777777777777777777",
        },
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(json.success).toBe(true);
    expect(json.extraGas).toBe(false);
  });

}

export function registerWithdrawValidationPostQuoteTests(): void {
  test("fails closed when relayed withdrawals omit the recipient in machine mode", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "require --to",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects the deprecated --unsigned-format flag with a targeted INPUT error", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
          unsignedFormat: "tx" as "tx",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "replaced by --unsigned [format]",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects unsupported unsigned output formats before loading account state", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
          unsigned: "raw" as "raw",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      'Unsupported unsigned format: "raw"',
    );
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("requires an asset when --all is used", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("--all requires an asset");
    expect(exitCode).toBe(2);
  });

  test("rejects invalid percentage withdrawals before loading pool state", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "150%",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Invalid percentage");
    expect(resolvePoolMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

}

export function registerWithdrawInteractiveAssetSelectionTests(): void {
  test("prompts humans to choose an asset when it is omitted", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => "ETH");

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

}

export function registerWithdrawDirectCompletionTests(): void {
  test("renders a direct JSON dry-run after proof generation", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          dryRun: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("direct");
    expect(json.dryRun).toBe(true);
    expect(json.proofPublicSignals).toBe(3);
  });

  test("continues with a human direct withdrawal after the privacy confirmation", async () => {
    useIsolatedHome({ withSigner: true });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(confirmPromptMock).toHaveBeenCalledTimes(1);
    expect(withdrawDirectMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Direct withdrawal confirmed");
  });

  test("fails closed when waiting for a direct withdrawal receipt times out", async () => {
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
          direct: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Timed out waiting for withdrawal confirmation",
    );
    expect(exitCode).toBe(3);
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

export function registerWithdrawDirectPostSaveTests(): void {
  test("prints direct save warnings for human callers after onchain confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    saveAccountMock.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ yes: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Withdrawal confirmed onchain but failed to save locally");
    expect(stderr).toContain("privacy-pools sync");
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
        buildRelayerQuote({
          feeBPS: "275",
          expiration: initialNow + 10_000,
          signedRelayerCommitment: "0x02",
        }),
      );
    Date.now = () => (++nowCalls <= 2 ? initialNow : expiredNow);

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
    const expiredNow = 1_700_000_003_000;
    requestQuoteMock
      .mockImplementationOnce(async () =>
        buildRelayerQuote({ expiration: initialNow + 1_000 }),
      )
      .mockImplementationOnce(async () =>
        buildRelayerQuote({
          expiration: initialNow + 10_000,
          feeRecipient:
            "0x9999999999999999999999999999999999999999" as Address,
        }),
      );
    Date.now = () => (++nowCalls <= 2 ? initialNow : expiredNow);

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
