import { expect, mock, test } from "bun:test";
import {
  APPROVED_POOL_ACCOUNT,
  ETH_POOL,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  confirmPromptMock,
  expectUnsignedTransactions,
  fakeCommand,
  getPublicClientMock,
  handleWithdrawCommand,
  initializeAccountServiceMock,
  saveAccountMock,
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
