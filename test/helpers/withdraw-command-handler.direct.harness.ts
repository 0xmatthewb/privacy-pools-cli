import { expect, mock, test } from "bun:test";
import {
  APPROVED_POOL_ACCOUNT,
  ETH_POOL,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  confirmPromptMock,
  expectPrintedRawTransactions,
  expectUnsignedTransactions,
  fakeCommand,
  getPublicClientMock,
  handleWithdrawCommand,
  inputPromptMock,
  initializeAccountServiceMock,
  maybeRenderPreviewScenarioMock,
  printRawTransactionsMock,
  saveAccountMock,
  selectPromptMock,
  useIsolatedHome,
  withdrawDirectMock,
} from "./withdraw-command-handler.shared.ts";

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
          confirmDirectWithdraw: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("withdraw");
    expect(json.unsigned).toBe(true);
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

  test("prints raw unsigned direct withdrawal transactions when --unsigned tx is requested", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: "tx",
          confirmDirectWithdraw: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expectPrintedRawTransactions(printRawTransactionsMock, [
      {
        chainId: 1,
        from: "0x5555555555555555555555555555555555555555",
        to: ETH_POOL.pool,
        value: "0",
        description: "Direct withdraw from Privacy Pool",
      },
    ]);
  });

  test("fails closed when unsigned direct withdrawals omit --to", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Direct withdrawal requires --to <address> in unsigned mode",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when unsigned direct withdrawals omit privacy-loss acknowledgement", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
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

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_DIRECT_WITHDRAW_CONSENT_REQUIRED");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Direct withdrawal requires explicit privacy-loss acknowledgement",
    );
    expect(exitCode).toBe(2);
  });

}
export function registerWithdrawDirectUnsignedAndSubmitTests(): void {
  test("fails closed when direct withdrawals target a recipient that differs from the signer", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          confirmDirectWithdraw: true,
          to: "0x6666666666666666666666666666666666666666",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_DIRECT_WITHDRAW_RECIPIENT_MISMATCH");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Direct withdrawal --to must match your signer address",
    );
    expect(exitCode).toBe(2);
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("requires the extra agent privacy acknowledgement for direct withdrawals", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ agent: true, chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_DIRECT_WITHDRAW_AGENT_ACK_REQUIRED");
    expect(json.error.nextActions[0].cliCommand).toContain(
      "--break-privacy-acknowledged",
    );
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("submits a direct withdrawal to the signer address when requested", async () => {
    useIsolatedHome({ withSigner: true });
    const addWithdrawalCommitmentMock = mock(() => undefined);
    const statusEvents: string[] = [];
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
    withdrawDirectMock.mockImplementationOnce(async (...args) => {
      const statusHooks = args[6] as
        | {
            onSimulating?: () => void;
            onBroadcasting?: () => void;
          }
        | undefined;
      statusHooks?.onSimulating?.();
      statusEvents.push("simulating");
      statusHooks?.onBroadcasting?.();
      statusEvents.push("broadcasting");
      return {
        hash: "0x" + "56".repeat(32),
      };
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("withdraw");
    expect(json.withdrawMode).toBe("direct");
    expect(json.txHash).toBe("0x" + "56".repeat(32));
    expect(addWithdrawalCommitmentMock).toHaveBeenCalledTimes(1);
    expect(statusEvents).toEqual(["simulating", "broadcasting"]);
  });

  test("submits a direct withdrawal without waiting when requested by an acknowledged agent", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          confirmDirectWithdraw: true,
          breakPrivacyAcknowledged: true,
          noWait: true,
        },
        fakeCommand({ agent: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toBe("");
    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("withdraw");
    expect(json.withdrawMode).toBe("direct");
    expect(json.status).toBe("submitted");
    expect(typeof json.submissionId).toBe("string");
    expect(json.localStateSynced).toBe(false);
    expect(withdrawDirectMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).not.toHaveBeenCalled();
  });

}
export function registerWithdrawDirectCompletionTests(): void {
  test("returns early when preview rendering takes over direct withdrawal confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string) => commandKey === "withdraw direct confirm",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("publicly link your deposit and withdrawal addresses");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("cancels from the human direct withdrawal review prompt", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => "cancel");

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
    expect(stderr).toContain("Withdrawal cancelled.");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("switches from the human direct review back to relayed guidance", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => "switch");

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

    expect(stderr).toContain("Direct withdrawal cancelled");
    expect(stderr).toContain("privacy-pools withdraw 0.1 ETH");
    expect(stderr).toContain("--to");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("lets humans edit a direct amount from review before cancelling", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock
      .mockImplementationOnce(async () => "back")
      .mockImplementationOnce(async () => "cancel");
    inputPromptMock.mockImplementationOnce(async () => "0.2");

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

    expect(inputPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Updated withdrawal amount: 0.2 ETH");
    expect(stderr).toContain("Withdrawal cancelled.");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

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
    expect(json.mode).toBe("withdraw");
    expect(json.withdrawMode).toBe("direct");
    expect(json.dryRun).toBe(true);
    expect(json.proofPublicSignals).toBe(3);
  });

  test("renders a human direct dry-run without submitting a transaction", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          dryRun: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run: validation succeeded");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("continues with a human direct withdrawal after the privacy confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    inputPromptMock.mockImplementationOnce(async () => "DIRECT");

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(confirmPromptMock).toHaveBeenCalledTimes(0);
    expect(inputPromptMock).toHaveBeenCalledTimes(1);
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
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_NETWORK_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Timed out waiting for withdrawal confirmation",
    );
    expect(json.error.details.txHash).toBe(`0x${"56".repeat(32)}`);
    expect(exitCode).toBe(3);
  });

  test("fails closed when the direct withdrawal transaction reverts onchain", async () => {
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
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("CONTRACT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Withdrawal transaction reverted",
    );
    expect(exitCode).toBe(7);
  });

  test("fails closed when the pool root changes before direct proof generation", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "latestRoot" ? 2n : functionName === "ROOT_HISTORY_SIZE" ? 0n : 1n,
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
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain(
      "out of sync with the chain",
    );
    expect(exitCode).toBe(8);
  });

  test("fails closed when the pool root changes after direct proof generation", async () => {
    useIsolatedHome({ withSigner: true });
    let latestRootReads = 0;
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "latestRoot") {
          latestRootReads += 1;
          return latestRootReads >= 3 ? 2n : 1n;
        }
        return functionName === "ROOT_HISTORY_SIZE" ? 0n : 1n;
      },
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
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain(
      "Pool state changed after proof generation",
    );
    expect(exitCode).toBe(8);
  });

  test("fails closed when the pool root changes before direct submission", async () => {
    useIsolatedHome({ withSigner: true });
    let latestRootReads = 0;
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "latestRoot") {
          latestRootReads += 1;
          return latestRootReads >= 4 ? 2n : 1n;
        }
        return functionName === "ROOT_HISTORY_SIZE" ? 0n : 1n;
      },
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
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain(
      "Pool state changed before submission",
    );
    expect(exitCode).toBe(8);
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
          confirmDirectWithdraw: true,
        },
        fakeCommand({ yes: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Withdrawal confirmed onchain but failed to save locally");
    expect(stderr).toContain("privacy-pools sync");
  });

  test("accepts the hidden legacy direct-withdraw acknowledgement alias", async () => {
    useIsolatedHome({ withSigner: true });

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          confirmDirectWithdraw: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("withdraw");
    expect(json.withdrawMode).toBe("direct");
  });

}
