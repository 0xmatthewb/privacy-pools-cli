import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { captureAsyncOutput, expectSilentOutput } from "../helpers/output.ts";
import {
  GLOBAL_SIGNER_ADDRESS,
  GLOBAL_SIGNER_PRIVATE_KEY,
  MISMATCH_SIGNER_ADDRESS,
  MISMATCH_SIGNER_PRIVATE_KEY,
  NEW_WALLET_ADDRESS,
  NEW_WALLET_PRIVATE_KEY,
  buildMockRelayerQuote,
  depositEthMock,
  failWorkflowSnapshotWriteOnCall,
  getWorkflowStatus,
  initializeAccountServiceMock,
  loadWorkflowSnapshot,
  overrideWorkflowTimingForTests,
  proveWithdrawalMock,
  publicClient,
  ragequitWorkflow,
  realConfig,
  realErrors,
  realWritePrivateFileAtomic,
  refreshExpiredRelayerQuoteForWithdrawalMock,
  registerWorkflowMockedHarness,
  requestQuoteMock,
  saveAccountMock,
  setPromptResponses,
  startWorkflow,
  state,
  submitRelayRequestMock,
  useImmediateTimers,
  validateRelayerQuoteForWithdrawalMock,
  watchWorkflow,
  writePrivateFileAtomicMock,
  writeWorkflowSecret,
  writeWorkflowSnapshot,
} from "../helpers/workflow-mocked.harness.ts";
import { WORKFLOW_SECRET_RECORD_VERSION, WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";

describe("workflow service mocked coverage", () => {
  registerWorkflowMockedHarness();
  test("configured flow start binds the original signer address into the saved workflow", async () => {
    const snapshot = await startWorkflow({
      amountInput: "0.01",
      assetInput: "ETH",
      recipient: "0x7777777777777777777777777777777777777777",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
      watch: false,
    });

    expect(snapshot.walletMode).toBe("configured");
    expect(snapshot.walletAddress).toBe(GLOBAL_SIGNER_ADDRESS);
    expect(snapshot.phase).toBe("awaiting_asp");
    expect(loadWorkflowSnapshot(snapshot.workflowId).walletAddress).toBe(
      GLOBAL_SIGNER_ADDRESS,
    );
  });

  test("flow start rejects amounts below the pool minimum before any deposit work", async () => {
    state.pool = {
      ...state.pool,
      minimumDepositAmount: 20_000_000_000_000_000n,
    };

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Deposit amount is below the minimum");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("machine-mode flow start rejects non-round amounts before submitting a deposit", async () => {
    await expect(
      startWorkflow({
        amountInput: "0.011",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Non-round amount 0.011 ETH may reduce privacy.");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("new-wallet flows require --export-new-wallet in machine mode", async () => {
    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Non-interactive workflow wallets require --export-new-wallet");
  });

  test("flow start rejects --export-new-wallet without --new-wallet", async () => {
    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        exportNewWallet: join(state.tempHome, "workflow-wallet.txt"),
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("--export-new-wallet requires --new-wallet");
  });

  test("new-wallet flows reject backup paths whose parent directory is missing", async () => {
    const backupPath = join(state.tempHome, "missing", "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup directory does not exist");

    expect(existsSync(backupPath)).toBe(false);
    const secretsDir = realConfig.getWorkflowSecretsDir();
    expect(
      existsSync(secretsDir) ? readdirSync(secretsDir) : [],
    ).toHaveLength(0);
  });

  test("new-wallet flows reject backup paths whose parent is a file", async () => {
    const parentPath = join(state.tempHome, "not-a-directory");
    writeFileSync(parentPath, "nope", "utf8");
    const backupPath = join(parentPath, "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup parent is not a directory");
  });

  test("new-wallet flows reject existing backup targets without overwriting them", async () => {
    const backupPath = join(state.tempHome, "workflow-wallet.txt");
    writeFileSync(backupPath, "do not overwrite", "utf8");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup file already exists");

    expect(readFileSync(backupPath, "utf8")).toBe("do not overwrite");
    const secretsDir = realConfig.getWorkflowSecretsDir();
    expect(
      existsSync(secretsDir) ? readdirSync(secretsDir) : [],
    ).toHaveLength(0);
  });

  test("new-wallet flows reject directory backup targets", async () => {
    const backupPath = join(state.tempHome, "existing-directory");
    mkdirSync(backupPath, { recursive: true });

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup path must point to a file");
  });

  test("new-wallet setup does not write secrets or backups before readiness checks pass", async () => {
    state.gasPriceError = true;
    const backupPath = join(state.tempHome, "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Could not estimate the workflow wallet gas reserve");

    expect(existsSync(backupPath)).toBe(false);
    const secretsDir = realConfig.getWorkflowSecretsDir();
    expect(
      existsSync(secretsDir) ? readdirSync(secretsDir) : [],
    ).toHaveLength(0);
  });

  test("configured ERC20 flows fail closed when approval confirmation times out", async () => {
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 0n;
    state.nativeBalance = 0n;
    state.approvalReceiptMode = "timeout";

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Timed out waiting for approval confirmation.");

    expect(state.approveErc20Calls).toBe(1);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("configured ERC20 flows fail closed when approval reverts", async () => {
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;
    state.approvalReceiptMode = "reverted";

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Approval transaction reverted");

    expect(state.approveErc20Calls).toBe(1);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("configured deposits fail closed when confirmation reverts", async () => {
    state.depositConfirmationMode = "reverted";

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Deposit transaction reverted");

    expect(state.depositEthCalls).toBe(1);
    expect(state.addPoolAccountCalls).toBe(0);
  });

  test("configured deposits fail closed when confirmation times out", async () => {
    state.depositConfirmationMode = "timeout";

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Timed out waiting for deposit confirmation.");

    expect(state.depositEthCalls).toBe(1);
    expect(state.addPoolAccountCalls).toBe(0);
  });

  test("configured deposits fail closed when receipt metadata cannot be recovered", async () => {
    state.depositConfirmationMode = "missing_metadata";

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow(
      "Deposit confirmed, but the workflow could not capture the new Pool Account metadata.",
    );

    expect(state.depositEthCalls).toBe(1);
    expect(state.addPoolAccountCalls).toBe(0);
  });

  test("configured deposits continue when local account persistence fails after confirmation", async () => {
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    let snapshot!: Awaited<ReturnType<typeof startWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("awaiting_asp");
    expect(snapshot.depositTxHash).toBe(state.depositTxHash);
    expect(state.addPoolAccountCalls).toBe(1);
    expect(saveAccountMock).toHaveBeenCalled();
  });

  test("new-wallet ERC20 flow completes with extra gas enabled and no global signer", async () => {
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const backupPath = join(state.tempHome, "workflow-wallet.txt");
    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        privacyDelayProfile: "off",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      });

      expect(snapshot.phase).toBe("completed");
      expect(snapshot.walletMode).toBe("new_wallet");
      expect(snapshot.walletAddress).toBe(NEW_WALLET_ADDRESS);
      expect(snapshot.requiredTokenFunding).toBe("100000000");
      expect(state.loadPrivateKeyCalls).toBe(0);
      expect(state.approveErc20Calls).toBe(1);
      expect(state.depositErc20Calls).toBe(1);
      expect(state.requestQuoteCalls.at(-1)?.extraGas).toBe(true);
      expect(state.requestQuoteCalls.at(-1)?.relayerUrl).toBe(state.relayerUrl);
      expect(readFileSync(backupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
      expect(statSync(backupPath).mode & 0o777).toBe(0o600);
      expect(
        existsSync(
          join(realConfig.getWorkflowSecretsDir(), `${snapshot.workflowId}.json`),
        ),
      ).toBe(false);
    } finally {
      restoreTimers();
    }
  });

  test("configured flow start --watch completes the approved path", async () => {
    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        privacyDelayProfile: "off",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: true,
      });

      expect(snapshot.phase).toBe("completed");
      expect(snapshot.depositTxHash).toBe(state.depositTxHash);
      expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
      expect(state.depositEthCalls).toBe(1);
      expect(state.requestQuoteCalls).toHaveLength(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow does not re-submit a pending public deposit", async () => {
    state.pendingReceiptAvailableAfter = 1;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-pending", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-pending",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(1);
      expect(getWorkflowStatus({ workflowId: "wf-pending" }).depositBlockNumber).toBe("101");
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow refreshes saved funding requirements before retrying a new-wallet deposit", async () => {
    state.pool = {
      ...state.pool,
      asset: "0x9999999999999999999999999999999999999999",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100_000_000n;
    state.nativeBalance = 1n;
    state.gasPrice = 1_000_000_000_000n;

    const stop = new Error("stop after first funding sleep");
    overrideWorkflowTimingForTests({
      sleep: async () => {
        throw stop;
      },
    });

    writeWorkflowSecret("wf-funding-refresh");
    writeWorkflowSnapshot("wf-funding-refresh", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      asset: "USDC",
      assetDecimals: 6,
      depositAmount: "100000000",
      requiredNativeFunding: "1",
      requiredTokenFunding: "100000000",
      estimatedCommittedValue: "99500000",
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      committedValue: null,
      aspStatus: undefined,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-funding-refresh",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow(stop.message);

    const refreshed = loadWorkflowSnapshot("wf-funding-refresh");
    expect(refreshed.phase).toBe("awaiting_funding");
    expect(BigInt(refreshed.requiredNativeFunding ?? "0")).toBeGreaterThan(1n);
    expect(refreshed.requiredTokenFunding).toBe("100000000");
    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("watchWorkflow fails closed when a saved deposit may have been submitted without a persisted tx hash", async () => {
    writeWorkflowSecret("wf-ambiguous-deposit");
    writeWorkflowSnapshot("wf-ambiguous-deposit", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-ambiguous-deposit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    const failedSnapshot = getWorkflowStatus({ workflowId: "wf-ambiguous-deposit" });
    expect(failedSnapshot.phase).toBe("depositing_publicly");
    expect(failedSnapshot.depositTxHash).toBeNull();
    expect(failedSnapshot.lastError?.step).toBe("deposit");
    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);

    await expect(
      watchWorkflow({
        workflowId: "wf-ambiguous-deposit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("watchWorkflow returns saved terminal workflows without advancing them again", async () => {
    writeWorkflowSnapshot("wf-terminal", {
      phase: "completed",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: "101",
      depositExplorerUrl: "https://example.invalid/tx/terminal",
      committedValue: state.committedValue.toString(),
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: "202",
      withdrawExplorerUrl: "https://example.invalid/tx/withdraw",
    });

    const result = await watchWorkflow({
      workflowId: "wf-terminal",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(result.phase).toBe("completed");
    expect(state.depositEthCalls).toBe(0);
    expect(state.submitRagequitCalls).toBe(0);
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow does not retry after a checkpoint failure without a saved tx hash", async () => {
    writeWorkflowSecret("wf-checkpoint-failed");
    writeWorkflowSnapshot("wf-checkpoint-failed", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
      lastError: {
        step: "deposit",
        errorCode: "WORKFLOW_DEPOSIT_CHECKPOINT_FAILED",
        errorMessage: "Public deposit was submitted, but the workflow could not checkpoint it locally.",
        retryable: false,
        at: "2026-03-24T12:00:00.000Z",
      },
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-checkpoint-failed",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("watchWorkflow does not retry legacy checkpoint failures without a saved tx hash", async () => {
    writeWorkflowSecret("wf-legacy-checkpoint-failed");
    writeWorkflowSnapshot("wf-legacy-checkpoint-failed", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
      lastError: {
        step: "deposit",
        errorCode: "INPUT_ERROR",
        errorMessage: "Public deposit was submitted, but the workflow could not checkpoint it locally.",
        retryable: false,
        at: "2026-03-24T12:00:00.000Z",
      },
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-legacy-checkpoint-failed",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("watchWorkflow retries retryable relayer quote failures instead of exiting", async () => {
    let requestAttempts = 0;
    const sleepCalls: number[] = [];
    requestQuoteMock.mockImplementation(async (_chain, args) => {
      state.requestQuoteCalls.push(args);
      requestAttempts += 1;
      if (requestAttempts === 1) {
        throw new realErrors.CLIError(
          "Temporary relayer issue",
          "RELAYER",
          "Retry soon.",
          "RELAYER_TEMPORARY",
          true,
        );
      }
      return buildMockRelayerQuote(args);
    });
    overrideWorkflowTimingForTests({
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    writeWorkflowSnapshot("wf-retryable-quote", {
      phase: "approved_ready_to_withdraw",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    const { stderr } = await captureAsyncOutput(async () => {
      const snapshot = await watchWorkflow({
        workflowId: "wf-retryable-quote",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("completed");
    });

    expect(requestAttempts).toBe(2);
    expect(sleepCalls.length).toBeGreaterThan(0);
    expect(stderr).toContain("Temporary issue while resuming this workflow");
    expect(stderr).toContain("Retrying in");
  });

  test("watchWorkflow reattaches a confirmed pending deposit before continuing", async () => {
    state.pendingReceiptAvailableAfter = 0;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-pending-confirmed", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-pending-confirmed",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(snapshot.depositBlockNumber).toBe("101");
      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow keeps waiting for mining until the submitted deposit is indexed", async () => {
    state.pendingReceiptAvailableAfter = 1;
    state.poolAccountAvailable = false;
    state.poolAccountAvailableAfterReceiptChecks = 1;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-pending-mining", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-pending-mining",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(snapshot.depositBlockNumber).toBe("101");
      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(2);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow reconciles a depositing snapshot from local account state when the receipt lookup is still pending", async () => {
    state.pendingReceiptAvailableAfter = 99;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-local-deposit-reconcile", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-local-deposit-reconcile",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(snapshot.depositBlockNumber).toBe("101");
      expect(snapshot.poolAccountId).toBe("PA-7");
      expect(state.getTransactionReceiptCalls).toBe(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow pauses configured flows when the ASP declines them", async () => {
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-declined", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-declined",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_declined");
    expect(snapshot.aspStatus).toBe("declined");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow schedules privacy delay once and completes after the persisted deadline", async () => {
    let nowMs = Date.parse("2026-03-24T12:00:00.000Z");
    const sleepCalls: number[] = [];
    let sampleCalls = 0;
    let advancedMs = 0;
    overrideWorkflowTimingForTests({
      nowMs: () => nowMs,
      samplePrivacyDelayMs: () => {
        sampleCalls += 1;
        return 20 * 60_000;
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
        expect(state.requestQuoteCalls).toHaveLength(0);
        nowMs += ms;
        advancedMs += ms;
      },
    });

    writeWorkflowSnapshot("wf-privacy-delay", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      privacyDelayProfile: "balanced",
      privacyDelayConfigured: true,
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-privacy-delay",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed");
    expect(snapshot.privacyDelayProfile).toBe("balanced");
    expect(snapshot.approvalObservedAt).toBe("2026-03-24T12:00:00.000Z");
    expect(snapshot.privacyDelayUntil).toBeNull();
    expect(sampleCalls).toBe(1);
    expect(sleepCalls.every((value) => value > 0 && value <= 300_000)).toBe(true);
    expect(advancedMs).toBe(20 * 60_000);
    expect(state.requestQuoteCalls).toHaveLength(1);
  });

  test("watchWorkflow does not resample a saved privacy delay after restart", async () => {
    let nowMs = Date.parse("2026-03-24T12:00:00.000Z");
    let sampleCalls = 0;
    const detach = new Error("detach after first sleep");
    overrideWorkflowTimingForTests({
      nowMs: () => nowMs,
      samplePrivacyDelayMs: () => {
        sampleCalls += 1;
        return 20 * 60_000;
      },
      sleep: async (ms) => {
        nowMs += ms;
        throw detach;
      },
    });

    writeWorkflowSnapshot("wf-privacy-delay-restart", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      privacyDelayProfile: "balanced",
      privacyDelayConfigured: true,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-privacy-delay-restart",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow(detach.message);

    const delayed = loadWorkflowSnapshot("wf-privacy-delay-restart");
    expect(delayed.phase).toBe("approved_waiting_privacy_delay");
    expect(delayed.approvalObservedAt).toBe("2026-03-24T12:00:00.000Z");
    expect(delayed.privacyDelayUntil).toBe("2026-03-24T12:20:00.000Z");

    overrideWorkflowTimingForTests({
      nowMs: () => nowMs,
      samplePrivacyDelayMs: () => {
        sampleCalls += 1;
        return 20 * 60_000;
      },
      sleep: async (ms) => {
        nowMs += ms;
      },
    });

    const resumed = await watchWorkflow({
      workflowId: "wf-privacy-delay-restart",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(resumed.phase).toBe("completed");
    expect(sampleCalls).toBe(1);
  });

  test("watchWorkflow lets an explicit off override clear a saved privacy delay", async () => {
    const sleepCalls: number[] = [];
    overrideWorkflowTimingForTests({
      nowMs: () => Date.parse("2026-03-24T12:00:00.000Z"),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    writeWorkflowSnapshot("wf-privacy-delay-off", {
      phase: "approved_waiting_privacy_delay",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      privacyDelayProfile: "balanced",
      privacyDelayConfigured: true,
      approvalObservedAt: "2026-03-24T11:00:00.000Z",
      privacyDelayUntil: "2026-03-24T13:00:00.000Z",
      aspStatus: "approved",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-privacy-delay-off",
      privacyDelayProfile: "off",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed");
    expect(snapshot.privacyDelayProfile).toBe("off");
    expect(snapshot.privacyDelayUntil).toBeNull();
    expect(state.requestQuoteCalls).toHaveLength(1);
    expect(sleepCalls).toHaveLength(0);
  });

  test("watchWorkflow prints a human acknowledgment when clearing a saved privacy delay", async () => {
    overrideWorkflowTimingForTests({
      nowMs: () => Date.parse("2026-03-24T12:00:00.000Z"),
      sleep: async () => undefined,
    });

    writeWorkflowSnapshot("wf-privacy-delay-off-message", {
      phase: "approved_waiting_privacy_delay",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      privacyDelayProfile: "balanced",
      privacyDelayConfigured: true,
      approvalObservedAt: "2026-03-24T11:00:00.000Z",
      privacyDelayUntil: "2026-03-24T13:00:00.000Z",
      aspStatus: "approved",
    });

    const { stderr } = await captureAsyncOutput(async () => {
      const snapshot = await watchWorkflow({
        workflowId: "wf-privacy-delay-off-message",
        privacyDelayProfile: "off",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("completed");
    });

    expect(stderr).toContain(
      "Saved privacy-delay policy updated to Off (no added hold). Any existing privacy-delay hold was cleared.",
    );
  });

  test("watchWorkflow reschedules approved privacy delays when switching profiles", async () => {
    let nowMs = Date.parse("2026-03-24T12:00:00.000Z");
    const stop = new Error("stop after reschedule");
    let sampleCalls = 0;
    overrideWorkflowTimingForTests({
      nowMs: () => nowMs,
      samplePrivacyDelayMs: (profile) => {
        sampleCalls += 1;
        return profile === "aggressive" ? 4 * 60 * 60_000 : 30 * 60_000;
      },
      sleep: async (ms) => {
        nowMs += ms;
        throw stop;
      },
    });

    writeWorkflowSnapshot("wf-privacy-delay-switch", {
      phase: "approved_waiting_privacy_delay",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      privacyDelayProfile: "balanced",
      privacyDelayConfigured: true,
      approvalObservedAt: "2026-03-24T11:00:00.000Z",
      privacyDelayUntil: "2026-03-24T12:30:00.000Z",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-privacy-delay-switch",
        privacyDelayProfile: "aggressive",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow(stop.message);

    const rescheduled = loadWorkflowSnapshot("wf-privacy-delay-switch");
    expect(rescheduled.phase).toBe("approved_waiting_privacy_delay");
    expect(rescheduled.privacyDelayProfile).toBe("aggressive");
    expect(rescheduled.approvalObservedAt).toBe("2026-03-24T12:00:00.000Z");
    expect(rescheduled.privacyDelayUntil).toBe("2026-03-24T16:00:00.000Z");
    expect(sampleCalls).toBe(1);
  });

  test("watchWorkflow prints a human acknowledgment when rescheduling privacy delay", async () => {
    let nowMs = Date.parse("2026-03-24T12:00:00.000Z");
    const stop = new Error("stop after reschedule");
    overrideWorkflowTimingForTests({
      nowMs: () => nowMs,
      samplePrivacyDelayMs: () => 4 * 60 * 60_000,
      sleep: async (ms) => {
        nowMs += ms;
        throw stop;
      },
    });

    writeWorkflowSnapshot("wf-privacy-delay-switch-message", {
      phase: "approved_waiting_privacy_delay",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      privacyDelayProfile: "balanced",
      privacyDelayConfigured: true,
      approvalObservedAt: "2026-03-24T11:00:00.000Z",
      privacyDelayUntil: "2026-03-24T12:30:00.000Z",
      aspStatus: "approved",
    });

    const { stderr } = await captureAsyncOutput(async () => {
      await expect(
        watchWorkflow({
          workflowId: "wf-privacy-delay-switch-message",
          privacyDelayProfile: "aggressive",
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: false,
            format: "table",
            skipPrompts: true,
          },
          isVerbose: false,
        }),
      ).rejects.toThrow(stop.message);
    });

    expect(stderr).toContain("Saved privacy-delay policy updated from");
    expect(stderr).toContain("Aggressive (randomized 2 to 12 hours)");
    expect(stderr).toContain("local time");
  });

  test("watchWorkflow updates pending workflows to a configured privacy-delay policy before approval", async () => {
    let nowMs = Date.parse("2026-03-24T12:00:00.000Z");
    const stop = new Error("stop while still pending");
    state.aspStatus = "pending";
    overrideWorkflowTimingForTests({
      nowMs: () => nowMs,
      sleep: async (ms) => {
        nowMs += ms;
        throw stop;
      },
    });

    writeWorkflowSnapshot("wf-privacy-delay-pending", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      privacyDelayProfile: "off",
      privacyDelayConfigured: false,
      aspStatus: "pending",
    });

    const { stderr } = await captureAsyncOutput(async () => {
      await expect(
        watchWorkflow({
          workflowId: "wf-privacy-delay-pending",
          privacyDelayProfile: "aggressive",
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: false,
            format: "table",
            skipPrompts: true,
          },
          isVerbose: false,
        }),
      ).rejects.toThrow(stop.message);
    });

    const updated = loadWorkflowSnapshot("wf-privacy-delay-pending");
    expect(updated.phase).toBe("awaiting_asp");
    expect(updated.privacyDelayProfile).toBe("aggressive");
    expect(updated.privacyDelayConfigured).toBe(true);
    expect(updated.approvalObservedAt).toBeNull();
    expect(updated.privacyDelayUntil).toBeNull();
    expect(stderr).toContain("Saved privacy-delay policy updated from");
    expect(stderr).not.toContain("This workflow is now waiting until");
  });

  test("watchWorkflow pauses flows that require Proof of Association", async () => {
    state.aspStatus = "poi_required";
    writeWorkflowSnapshot("wf-poi", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-poi",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_poi_required");
    expect(snapshot.aspStatus).toBe("poi_required");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow stops when the saved workflow no longer matches the Pool Account state", async () => {
    writeWorkflowSnapshot("wf-mismatch", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      committedValue: "1",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-mismatch",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("stopped_external");
    expect(snapshot.workflowId).toBe("wf-mismatch");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow reconciles paused declined workflows after manual recovery", async () => {
    state.poolAccountStatus = "exited";
    writeWorkflowSnapshot("wf-declined-external-ragequit", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-declined-external-ragequit",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("stopped_external");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow cleans up new-wallet secrets once the workflow stops externally", async () => {
    writeWorkflowSecret("wf-new-wallet-external-stop");
    writeWorkflowSnapshot("wf-new-wallet-external-stop", {
      phase: "awaiting_asp",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositLabel: state.label.toString(),
      committedValue: "1",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-new-wallet-external-stop",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("stopped_external");
    expect(
      existsSync(
        join(
          realConfig.getWorkflowSecretsDir(),
          "wf-new-wallet-external-stop.json",
        ),
      ),
    ).toBe(false);
  });

  test("watchWorkflow keeps paused declined workflows readable during ASP outages", async () => {
    state.aspStatus = "declined";
    state.aspUnavailable = true;
    writeWorkflowSnapshot("wf-declined-asp-outage", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-declined-asp-outage",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_declined");
    expect(snapshot.aspStatus).toBe("declined");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("configured flow ragequit fails fast when the signer no longer matches the original depositor", async () => {
    writeWorkflowSnapshot("wf-ragequit", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.currentSignerPrivateKey = MISMATCH_SIGNER_PRIVATE_KEY;

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow(
      `Configured signer ${MISMATCH_SIGNER_ADDRESS} does not match the original depositor ${GLOBAL_SIGNER_ADDRESS}.`,
    );
  });

  test("configured flow ragequit succeeds with the original signer", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.currentSignerPrivateKey = GLOBAL_SIGNER_PRIVATE_KEY;

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-configured-ragequit",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.loadPrivateKeyCalls).toBe(1);
    expect(state.submitRagequitCalls).toBe(1);
    expect(state.addRagequitCalls).toBe(1);
  });

  test("configured flow ragequit reconciles workflows already recovered manually", async () => {
    state.poolAccountStatus = "exited";
    writeWorkflowSnapshot("wf-configured-ragequit-external", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-configured-ragequit-external",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("stopped_external");
    expect(state.submitRagequitCalls).toBe(0);
    expect(state.addRagequitCalls).toBe(0);
  });

  test("configured flow ragequit does not depend on ASP availability", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-no-asp", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.aspUnavailable = true;

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-configured-ragequit-no-asp",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
  });

  test("configured flow ragequit fails closed when depositor preverification is unavailable", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-no-preverify", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    publicClient.readContract.mockImplementationOnce(async ({ functionName }: { functionName: string }) => {
      if (functionName === "depositors") {
        throw new Error("depositor lookup unavailable");
      }
      return functionName === "currentRoot" ? state.currentRoot : state.latestRoot;
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-configured-ragequit-no-preverify",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: true,
      }),
    ).rejects.toThrow("Unable to verify the original depositor for workflow ragequit.");
    expect(state.submitRagequitCalls).toBe(0);
  });

  test("configured flow ragequit still completes when local account persistence fails", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-save-warning", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    let snapshot!: Awaited<ReturnType<typeof ragequitWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await ragequitWorkflow({
        workflowId: "wf-configured-ragequit-save-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(saveAccountMock).toHaveBeenCalled();
  });

  test("configured flow ragequit does not retry when the tx hash cannot be checkpointed", async () => {
    failWorkflowSnapshotWriteOnCall(
      "wf-configured-ragequit-checkpoint-failure",
      2,
    );
    writeWorkflowSnapshot("wf-configured-ragequit-checkpoint-failure", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-configured-ragequit-checkpoint-failure",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("may have submitted a public recovery transaction");

    const checkpointed = getWorkflowStatus({
      workflowId: "wf-configured-ragequit-checkpoint-failure",
    });
    expect(checkpointed.pendingSubmission).toBe("ragequit");
    expect(checkpointed.ragequitTxHash).toBeNull();

    await expect(
      ragequitWorkflow({
        workflowId: "wf-configured-ragequit-checkpoint-failure",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("may have submitted a public recovery transaction");

    expect(state.submitRagequitCalls).toBe(1);
  });

  test("configured flow ragequit fails closed when confirmation times out", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-timeout", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.ragequitReceiptMode = "timeout";

    await expect(
      ragequitWorkflow({
        workflowId: "wf-configured-ragequit-timeout",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Timed out waiting for workflow ragequit confirmation.");
  });

  test("configured flow ragequit fails closed when confirmation reverts", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-revert", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.ragequitReceiptMode = "reverted";

    await expect(
      ragequitWorkflow({
        workflowId: "wf-configured-ragequit-revert",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow ragequit transaction reverted");
  });

  test("new-wallet ragequit succeeds with the stored workflow secret", async () => {
    writeWorkflowSecret("wf-new-wallet-ragequit");
    writeWorkflowSnapshot("wf-new-wallet-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.currentSignerPrivateKey = null;
    state.onchainDepositor = NEW_WALLET_ADDRESS;

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-new-wallet-ragequit",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.submitRagequitCalls).toBe(1);
    expect(state.addRagequitCalls).toBe(1);
    expect(
      existsSync(
        join(realConfig.getWorkflowSecretsDir(), "wf-new-wallet-ragequit.json"),
      ),
    ).toBe(false);
  });

  test("new-wallet ragequit fails cleanly when the stored workflow secret is missing", async () => {
    writeWorkflowSnapshot("wf-missing-secret-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-missing-secret-ragequit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow wallet secret is missing");
  });

  test("new-wallet ragequit fails cleanly when the stored workflow secret is unreadable", async () => {
    writeWorkflowSnapshot("wf-broken-secret-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    realConfig.ensureConfigDir();
    writeFileSync(
      join(realConfig.getWorkflowSecretsDir(), "wf-broken-secret-ragequit.json"),
      "{not-json",
      "utf8",
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-broken-secret-ragequit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow wallet secret is unreadable");
  });

  test("new-wallet ragequit fails cleanly when the stored workflow secret is malformed", async () => {
    writeWorkflowSnapshot("wf-invalid-secret-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    realConfig.ensureConfigDir();
    writeFileSync(
      join(realConfig.getWorkflowSecretsDir(), "wf-invalid-secret-ragequit.json"),
      JSON.stringify(
        {
          schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
          workflowId: "wf-invalid-secret-ragequit",
          chain: "sepolia",
          walletAddress: NEW_WALLET_ADDRESS,
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-invalid-secret-ragequit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow wallet secret has invalid structure");
  });

  test("ragequitWorkflow accepts explicit latest and waits on the saved public recovery tx", async () => {
    writeWorkflowSnapshot("wf-ragequit-older", {
      phase: "paused_declined",
      aspStatus: "declined",
      updatedAt: "2026-03-24T12:00:00.000Z",
    });
    writeWorkflowSnapshot("wf-ragequit-latest", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
      updatedAt: "2026-03-24T12:10:00.000Z",
    });

    const snapshot = await ragequitWorkflow({
      workflowId: "latest",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.workflowId).toBe("wf-ragequit-latest");
    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.submitRagequitCalls).toBe(0);
  });

  test("ragequitWorkflow waits for a saved public recovery when the quick receipt lookup is pending", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    writeWorkflowSnapshot("wf-ragequit-await-confirmation", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-ragequit-await-confirmation",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitBlockNumber).toBe("303");
    expect(state.submitRagequitCalls).toBe(0);
  });

  test("ragequitWorkflow fails closed when a saved public recovery times out while waiting for confirmation", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    state.ragequitReceiptMode = "timeout";
    writeWorkflowSnapshot("wf-ragequit-await-timeout", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-await-timeout",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Timed out waiting for workflow ragequit confirmation.");
  });

  test("ragequitWorkflow fails closed when a saved public recovery reverts while waiting for confirmation", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    state.ragequitReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-ragequit-await-revert", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-await-revert",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow ragequit transaction reverted");
  });

  test("watchWorkflow clears new-wallet secrets after a saved public recovery confirms", async () => {
    writeWorkflowSecret("wf-ragequit-watch");
    writeWorkflowSnapshot("wf-ragequit-watch", {
      phase: "paused_poi_required",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      aspStatus: "poi_required",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-ragequit-watch",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.submitRagequitCalls).toBe(0);
    expect(
      existsSync(join(realConfig.getWorkflowSecretsDir(), "wf-ragequit-watch.json")),
    ).toBe(false);
  });

  test("watchWorkflow leaves pending public recoveries unresolved when confirmation is still pending", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    writeWorkflowSnapshot("wf-ragequit-still-pending", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-ragequit-still-pending",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_declined");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(snapshot.ragequitBlockNumber).toBeNull();
  });

  test("watchWorkflow completes pending public recoveries even if local refresh fails", async () => {
    initializeAccountServiceMock.mockImplementation(async () => {
      throw new Error("refresh failed");
    });
    writeWorkflowSnapshot("wf-ragequit-refresh-warning", {
      phase: "paused_poi_required",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      aspStatus: "poi_required",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    let snapshot!: Awaited<ReturnType<typeof watchWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await watchWorkflow({
        workflowId: "wf-ragequit-refresh-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitBlockNumber).toBe("303");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
  });

  test("watchWorkflow fails closed when a pending public recovery reverts", async () => {
    state.ragequitPendingReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-ragequit-reverted", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-ragequit-reverted",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Previously submitted workflow ragequit reverted");

    expect(getWorkflowStatus({ workflowId: "wf-ragequit-reverted" }).lastError?.step).toBe(
      "inspect_approval",
    );
  });

  test("saved new-wallet workflows wait for funding and then complete once balances arrive", async () => {
    writeWorkflowSecret("wf-funded-later");
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.nativeBalanceSequence = [0n, 10n ** 18n, 10n ** 18n];
    state.tokenBalanceSequence = [0n, 100000000n, 100000000n];

    writeWorkflowSnapshot("wf-funded-later", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: "100000000",
      aspStatus: undefined,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-funded-later",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("completed");
      expect(state.depositErc20Calls).toBe(1);
      expect(state.approveErc20Calls).toBe(1);
      expect(getWorkflowStatus({ workflowId: "wf-funded-later" }).withdrawTxHash).toBe(
        state.relayTxHash,
      );
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow retries a new-wallet deposit after a submission failure before any tx hash is saved", async () => {
    writeWorkflowSecret("wf-retry-submit");
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.nativeBalance = 10n ** 18n;
    state.tokenBalance = 100000000n;
    state.depositErc20FailuresRemaining = 1;
    state.poolAccountAvailable = false;

    writeWorkflowSnapshot("wf-retry-submit", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: "100000000",
      aspStatus: undefined,
    });

    const restoreTimers = useImmediateTimers();
    try {
      await expect(
        watchWorkflow({
          workflowId: "wf-retry-submit",
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: true,
            isJson: true,
            isCsv: false,
            isQuiet: true,
            format: "json",
            skipPrompts: true,
          },
          isVerbose: false,
        }),
      ).rejects.toThrow("Simulated ERC20 deposit submission failure");

      const failedSnapshot = getWorkflowStatus({ workflowId: "wf-retry-submit" });
      expect(failedSnapshot.phase).toBe("depositing_publicly");
      expect(failedSnapshot.depositTxHash).toBeNull();
      expect(failedSnapshot.lastError?.step).toBe("deposit");
      expect(state.depositErc20Calls).toBe(1);

      const retriedSnapshot = await watchWorkflow({
        workflowId: "wf-retry-submit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(retriedSnapshot.phase).toBe("completed");
      expect(retriedSnapshot.depositTxHash).toBe(state.depositTxHash);
      expect(retriedSnapshot.lastError).toBeUndefined();
      expect(state.depositErc20Calls).toBe(2);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow saves a withdraw lastError when the relayer minimum blocks the flow", async () => {
    state.minWithdrawAmount = state.committedValue + 1n;
    writeWorkflowSnapshot("wf-relayer-min", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-relayer-min",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow amount is below the relayer minimum");

    const snapshot = getWorkflowStatus({ workflowId: "wf-relayer-min" });
    expect(snapshot.phase).toBe("approved_ready_to_withdraw");
    expect(snapshot.lastError?.step).toBe("withdraw");
    expect(snapshot.lastError?.errorMessage).toContain("below the relayer minimum");
  });

  test("watchWorkflow refreshes an expired relayer quote before proof generation", async () => {
    overrideWorkflowTimingForTests({
      nowMs: () => 3_000,
    });
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => ({
      quoteFeeBPS: 50n,
      expirationMs: 2_000,
    }));
    refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementationOnce(async () => ({
      quote: buildMockRelayerQuote({
        amount: state.committedValue,
        asset: state.pool.asset,
        extraGas: state.pool.symbol !== "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
      }, { expirationMs: 9_000 }),
      quoteFeeBPS: 50n,
      expirationMs: 9_000,
    }));
    writeWorkflowSnapshot("wf-refresh-before-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-refresh-before-proof",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed");
    expect(refreshExpiredRelayerQuoteForWithdrawalMock).toHaveBeenCalledTimes(1);
  });

  test("watchWorkflow refreshes an expired relayer quote after proof generation when the fee is unchanged", async () => {
    let nowCalls = 0;
    overrideWorkflowTimingForTests({
      nowMs: () => (++nowCalls === 1 ? 1_000 : 3_000),
    });
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => ({
      quoteFeeBPS: 50n,
      expirationMs: 2_000,
    }));
    refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementationOnce(async () => ({
      quote: buildMockRelayerQuote({
        amount: state.committedValue,
        asset: state.pool.asset,
        extraGas: state.pool.symbol !== "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
      }, { expirationMs: 9_000 }),
      quoteFeeBPS: 50n,
      expirationMs: 9_000,
    }));
    requestQuoteMock.mockImplementationOnce(async (_chain, args) => {
      state.requestQuoteCalls.push(args);
      return buildMockRelayerQuote(args, { expirationMs: 2_000 });
    });
    writeWorkflowSnapshot("wf-refresh-after-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-refresh-after-proof",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed");
    expect(refreshExpiredRelayerQuoteForWithdrawalMock).toHaveBeenCalledTimes(1);
  });

  test("watchWorkflow fails closed when the relayer fee changes after proof generation", async () => {
    let nowMs = 1_000;
    overrideWorkflowTimingForTests({
      nowMs: () => nowMs,
    });
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => ({
      quoteFeeBPS: 50n,
      expirationMs: 2_000,
    }));
    refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementationOnce(async () => ({
      quote: buildMockRelayerQuote({
        amount: state.committedValue,
        asset: state.pool.asset,
        extraGas: state.pool.symbol !== "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
      }, { feeBPS: "75", expirationMs: 9_000 }),
      quoteFeeBPS: 75n,
      expirationMs: 9_000,
    }));
    requestQuoteMock.mockImplementationOnce(async (_chain, args) => {
      state.requestQuoteCalls.push(args);
      return buildMockRelayerQuote(args, { expirationMs: 2_000 });
    });
    proveWithdrawalMock.mockImplementationOnce(async () => {
      nowMs = 3_000;
      return {
        proof: {
          pi_a: [1n, 2n],
          pi_b: [
            [3n, 4n],
            [5n, 6n],
          ],
          pi_c: [7n, 8n],
        },
        publicSignals: [13n, 14n, 15n, 16n],
      };
    });
    writeWorkflowSnapshot("wf-fee-change-after-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-fee-change-after-proof",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Relayer fee changed during proof generation");

    expect(getWorkflowStatus({ workflowId: "wf-fee-change-after-proof" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when the latest root changes before workflow proof generation", async () => {
    state.latestRootSequence = [2n];
    writeWorkflowSnapshot("wf-latest-root-before-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-latest-root-before-proof",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Pool state changed while preparing the workflow proof.");

    expect(getWorkflowStatus({ workflowId: "wf-latest-root-before-proof" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when the latest root changes before relay submission", async () => {
    state.latestRootSequence = [state.latestRoot, 2n];
    writeWorkflowSnapshot("wf-latest-root-before-submit", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-latest-root-before-submit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Pool state changed before submission.");

    expect(getWorkflowStatus({ workflowId: "wf-latest-root-before-submit" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when the workflow relayer quote request fails", async () => {
    requestQuoteMock.mockImplementationOnce(async () => {
      throw new Error("quote offline");
    });
    writeWorkflowSnapshot("wf-quote-request-failure", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-quote-request-failure",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("quote offline");

    expect(getWorkflowStatus({ workflowId: "wf-quote-request-failure" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when workflow relayer quote validation fails", async () => {
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => {
      throw new Error("Workflow relayer quote is invalid.");
    });
    writeWorkflowSnapshot("wf-quote-validation-failure", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-quote-validation-failure",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow relayer quote is invalid.");

    expect(getWorkflowStatus({ workflowId: "wf-quote-validation-failure" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when workflow relay submission fails", async () => {
    submitRelayRequestMock.mockImplementationOnce(async () => {
      throw new Error("relay unavailable");
    });
    writeWorkflowSnapshot("wf-relay-submit-failure", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-relay-submit-failure",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("relay unavailable");

    expect(getWorkflowStatus({ workflowId: "wf-relay-submit-failure" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow does not retry when relay submission cannot checkpoint the tx hash", async () => {
    const expectedPath = join(
      realConfig.getWorkflowsDir(),
      "wf-relay-checkpoint-failure.json",
    );
    writePrivateFileAtomicMock.mockImplementation((filePath, content) => {
      if (filePath === expectedPath && content.includes(state.relayTxHash)) {
        throw new Error("disk full");
      }
      return realWritePrivateFileAtomic(filePath, content);
    });
    writeWorkflowSnapshot("wf-relay-checkpoint-failure", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-relay-checkpoint-failure",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("may have submitted a relayed withdrawal");

    const checkpointed = getWorkflowStatus({
      workflowId: "wf-relay-checkpoint-failure",
    });
    expect(checkpointed.pendingSubmission).toBe("withdraw");
    expect(checkpointed.withdrawTxHash).toBeNull();

    await expect(
      watchWorkflow({
        workflowId: "wf-relay-checkpoint-failure",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("may have submitted a relayed withdrawal");

    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
  });

  test("watchWorkflow rejects a concurrent same-process watch for the same workflow", async () => {
    let releaseRelaySubmission: (() => void) | null = null;
    const relaySubmissionStarted = new Promise<void>((resolve) => {
      submitRelayRequestMock.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((resume) => {
          releaseRelaySubmission = resume;
        });
        return {
          txHash: state.relayTxHash,
        };
      });
    });

    writeWorkflowSnapshot("wf-concurrent-watch", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    const firstWatch = watchWorkflow({
      workflowId: "wf-concurrent-watch",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    await relaySubmissionStarted;

    await expect(
      watchWorkflow({
        workflowId: "wf-concurrent-watch",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Another saved workflow operation is already in progress");

    releaseRelaySubmission?.();
    const snapshot = await firstWatch;
    expect(snapshot.phase).toBe("completed");
    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
  });

  test("ragequitWorkflow rejects while a same-process watch is advancing the same workflow", async () => {
    let releaseRelaySubmission: (() => void) | null = null;
    const relaySubmissionStarted = new Promise<void>((resolve) => {
      submitRelayRequestMock.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((resume) => {
          releaseRelaySubmission = resume;
        });
        return {
          txHash: state.relayTxHash,
        };
      });
    });

    writeWorkflowSnapshot("wf-watch-ragequit-conflict", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    const firstWatch = watchWorkflow({
      workflowId: "wf-watch-ragequit-conflict",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    await relaySubmissionStarted;

    await expect(
      ragequitWorkflow({
        workflowId: "wf-watch-ragequit-conflict",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Another saved workflow operation is already in progress");

    releaseRelaySubmission?.();
    await firstWatch;
    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
  });

  test("watchWorkflow fails closed when a new-wallet funding snapshot is missing the wallet address", async () => {
    writeWorkflowSecret("wf-missing-wallet-address");
    writeWorkflowSnapshot("wf-missing-wallet-address", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: null,
      depositTxHash: null,
      depositBlockNumber: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-missing-wallet-address",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow wallet address is missing");

    expect(getWorkflowStatus({ workflowId: "wf-missing-wallet-address" }).lastError?.step).toBe(
      "funding",
    );
  });

  test("watchWorkflow fails closed when workflow withdrawal sees a stale pool root", async () => {
    state.currentRoot = 999n;
    writeWorkflowSnapshot("wf-stale-pool-root", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-stale-pool-root",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Pool data is out of date.");

    expect(getWorkflowStatus({ workflowId: "wf-stale-pool-root" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow still completes approved flows when local withdrawal persistence fails", async () => {
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });
    writeWorkflowSnapshot("wf-withdraw-save-warning", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    let snapshot!: Awaited<ReturnType<typeof watchWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await watchWorkflow({
        workflowId: "wf-withdraw-save-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
    expect(saveAccountMock).toHaveBeenCalled();
  });

  test("watchWorkflow fails closed when relayed withdrawal confirmation times out", async () => {
    state.relayReceiptMode = "timeout";
    writeWorkflowSnapshot("wf-withdraw-timeout", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-withdraw-timeout",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Timed out waiting for relayed withdrawal confirmation.");

    expect(getWorkflowStatus({ workflowId: "wf-withdraw-timeout" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when relayed withdrawal confirmation reverts", async () => {
    state.relayReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-withdraw-submit-reverted", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-withdraw-submit-reverted",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Relay transaction reverted");

    expect(
      getWorkflowStatus({ workflowId: "wf-withdraw-submit-reverted" }).lastError?.step,
    ).toBe("withdraw");
  });

  test("watchWorkflow fails closed when ASP roots are mid-update", async () => {
    state.aspMtRoot = state.latestRoot - 1n;
    writeWorkflowSnapshot("wf-asp-updating", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-asp-updating",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Withdrawal service data is still updating");

    expect(getWorkflowStatus({ workflowId: "wf-asp-updating" }).lastError?.step).toBe(
      "inspect_approval",
    );
  });

  test("watchWorkflow fails closed when a saved deposit receipt shows a revert", async () => {
    state.pendingReceiptMode = "reverted";
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    writeWorkflowSnapshot("wf-reverted-pending", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
      depositExplorerUrl: "https://example.test/deposit",
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: "100000000",
      aspStatus: undefined,
    });
    writeWorkflowSecret("wf-reverted-pending");

    const restoreTimers = useImmediateTimers();
    try {
      await expect(
        watchWorkflow({
          workflowId: "wf-reverted-pending",
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: true,
            isJson: true,
            isCsv: false,
            isQuiet: true,
            format: "json",
            skipPrompts: true,
          },
          isVerbose: false,
        }),
      ).rejects.toThrow("Previously submitted workflow deposit reverted");

      const failedSnapshot = getWorkflowStatus({ workflowId: "wf-reverted-pending" });
      expect(failedSnapshot.phase).toBe("depositing_publicly");
      expect(failedSnapshot.depositTxHash).toBe(state.depositTxHash);
      expect(failedSnapshot.depositBlockNumber).toBeNull();
      expect(failedSnapshot.lastError?.step).toBe("deposit");
      expect(failedSnapshot.lastError?.errorMessage).toContain("deposit reverted");
      expect(state.approveErc20Calls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow rebinds the saved Pool Account using the deposit label when numbering drifts", async () => {
    writeWorkflowSnapshot("wf-label-rebind", {
      phase: "awaiting_asp",
      poolAccountId: "PA-99",
      poolAccountNumber: 99,
      depositTxHash:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      depositLabel: state.label.toString(),
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-label-rebind",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed");
    expect(snapshot.poolAccountNumber).toBe(7);
    expect(snapshot.poolAccountId).toBe("PA-7");
    expect(snapshot.depositTxHash).toBe(state.depositTxHash);
  });

  test("watchWorkflow accepts explicit latest and resumes a submitted relayed withdrawal", async () => {
    writeWorkflowSnapshot("wf-watch-older", {
      phase: "awaiting_asp",
      aspStatus: "pending",
      updatedAt: "2026-03-24T12:00:00.000Z",
    });
    writeWorkflowSnapshot("wf-watch-latest", {
      phase: "withdrawing",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
      updatedAt: "2026-03-24T12:10:00.000Z",
    });

    const snapshot = await watchWorkflow({
      workflowId: "latest",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.workflowId).toBe("wf-watch-latest");
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
    expect(state.requestQuoteCalls).toHaveLength(0);
    expect(state.addWithdrawalCommitmentCalls).toBe(0);
  });

  test("watchWorkflow completes pending relayed withdrawals even if local refresh fails", async () => {
    initializeAccountServiceMock.mockImplementation(async () => {
      throw new Error("refresh failed");
    });
    writeWorkflowSnapshot("wf-withdraw-refresh-warning", {
      phase: "withdrawing",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
    });

    let snapshot!: Awaited<ReturnType<typeof watchWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await watchWorkflow({
        workflowId: "wf-withdraw-refresh-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.withdrawBlockNumber).toBe("202");
    expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
  });

  test("watchWorkflow fails closed when a pending relayed withdrawal reverts", async () => {
    state.relayReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-withdraw-reverted", {
      phase: "withdrawing",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-withdraw-reverted",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("Previously submitted workflow withdrawal reverted");

    expect(getWorkflowStatus({ workflowId: "wf-withdraw-reverted" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("interactive configured flows confirm the manual signer path before saving the workflow", async () => {
    setPromptResponses();

    const snapshot = await startWorkflow({
      amountInput: "0.01",
      assetInput: "ETH",
      recipient: "0x7777777777777777777777777777777777777777",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: false,
        isJson: false,
        isCsv: false,
        isQuiet: false,
        format: "table",
        skipPrompts: false,
      },
      isVerbose: false,
      watch: false,
    });

    expect(snapshot.phase).toBe("awaiting_asp");
    expect(snapshot.walletMode).toBe("configured");
    expect(snapshot.walletAddress).toBe(GLOBAL_SIGNER_ADDRESS);
    expect(snapshot.depositTxHash).toBe(state.depositTxHash);
  });

  test("configured flow start fails before deposit if the workflow checkpoint cannot be created", async () => {
    realConfig.ensureConfigDir();
    rmSync(realConfig.getWorkflowsDir(), { recursive: true, force: true });
    writeFileSync(realConfig.getWorkflowsDir(), "not-a-directory", "utf8");

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow(
      "Could not save this workflow locally before submitting the public deposit.",
    );

    expect(state.depositEthCalls).toBe(0);
  });

  test("configured flow start preserves a saved workflow checkpoint when deposit submission fails", async () => {
    state.depositEthFailuresRemaining = 1;

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Simulated ETH deposit submission failure");

    expect(state.depositEthCalls).toBe(1);
    const workflowFiles = readdirSync(realConfig.getWorkflowsDir()).filter((entry) =>
      entry.endsWith(".json"),
    );
    expect(workflowFiles).toHaveLength(1);

    const checkpointed = loadWorkflowSnapshot(
      workflowFiles[0].replace(/\.json$/, ""),
    );
    expect(checkpointed.phase).toBe("depositing_publicly");
    expect(checkpointed.walletMode).toBe("configured");
    expect(checkpointed.walletAddress).toBe(GLOBAL_SIGNER_ADDRESS);
    expect(checkpointed.depositTxHash).toBeNull();
    expect(checkpointed.lastError?.step).toBe("deposit");
  });

  test("configured flow start fails closed when the deposit tx hash cannot be checkpointed", async () => {
    depositEthMock.mockImplementationOnce(async () => {
      state.depositEthCalls += 1;
      state.poolAccountAvailable = true;
      return { hash: state.depositTxHash };
    });
    failWorkflowSnapshotWriteOnCall(null, 2);

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("could not checkpoint it locally");

    const workflowFiles = readdirSync(realConfig.getWorkflowsDir()).filter((entry) =>
      entry.endsWith(".json"),
    );
    expect(workflowFiles).toHaveLength(1);

    const workflowId = workflowFiles[0].replace(/\.json$/, "");
    const checkpointed = loadWorkflowSnapshot(workflowId);
    expect(checkpointed.phase).toBe("depositing_publicly");
    expect(checkpointed.depositTxHash).toBeNull();

    await expect(
      watchWorkflow({
        workflowId,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    expect(state.depositEthCalls).toBe(1);
  });

  test("new-wallet flow start cleans up the saved secret if the workflow snapshot cannot be persisted", async () => {
    realConfig.ensureConfigDir();
    rmSync(realConfig.getWorkflowsDir(), { recursive: true, force: true });
    writeFileSync(realConfig.getWorkflowsDir(), "not-a-directory", "utf8");
    const backupPath = join(state.tempHome, "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("ENOTDIR");

    expect(existsSync(backupPath)).toBe(true);
    const secretFiles = existsSync(realConfig.getWorkflowSecretsDir())
      ? readdirSync(realConfig.getWorkflowSecretsDir())
      : [];
    expect(secretFiles).toHaveLength(0);
  });

  test("interactive configured flows can cancel on the non-round amount privacy warning", async () => {
    setPromptResponses({ confirm: false });

    await expect(
      startWorkflow({
        amountInput: "0.011",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: false,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Flow cancelled.");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("interactive configured flows can cancel at the final confirmation prompt", async () => {
    setPromptResponses({ confirm: false });

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: false,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Flow cancelled.");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("interactive new-wallet flows can confirm backup and complete", async () => {
    setPromptResponses({ input: join(state.tempHome, "ignored-wallet.txt") });
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const backupPath = join(state.tempHome, "interactive-wallet.txt");
    const restoreTimers = useImmediateTimers();
    try {
      let snapshot: Awaited<ReturnType<typeof startWorkflow>> | null = null;
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        snapshot = await startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          privacyDelayProfile: "off",
          newWallet: true,
          exportNewWallet: backupPath,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: true,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        });
      });

      expect(stdout).toBe("");
      expect(stderr.trim()).toBe("");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.phase).toBe("completed");
      expect(snapshot!.backupConfirmed).toBe(true);
      expect(readFileSync(backupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
    } finally {
      restoreTimers();
    }
  });

  test("interactive new-wallet flows can choose a backup file path and complete", async () => {
    const promptedBackupPath = join(state.tempHome, "prompted-wallet.txt");
    setPromptResponses({ input: promptedBackupPath, select: "file" });
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const restoreTimers = useImmediateTimers();
    try {
      let snapshot: Awaited<ReturnType<typeof startWorkflow>> | null = null;
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        snapshot = await startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          privacyDelayProfile: "off",
          newWallet: true,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: true,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        });
      });

      expect(stdout).toBe("");
      expect(stderr.trim()).toBe("");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.phase).toBe("completed");
      expect(readFileSync(promptedBackupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
    } finally {
      restoreTimers();
    }
  });

  test("interactive new-wallet flows persist ERC20 funding requirements for follow-up", async () => {
    const promptedBackupPath = join(state.tempHome, "visible-wallet.txt");
    setPromptResponses({ input: promptedBackupPath, select: "file" });
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const restoreTimers = useImmediateTimers();
    try {
      const { stderr } = await captureAsyncOutput(async () => {
        const snapshot = await startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          privacyDelayProfile: "off",
          newWallet: true,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: false,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        });

        expect(snapshot.walletAddress).toBe(NEW_WALLET_ADDRESS);
        expect(snapshot.requiredTokenFunding).toBe("100000000");
        expect(BigInt(snapshot.requiredNativeFunding ?? "0")).toBeGreaterThan(0n);
      });

      expect(stderr).toContain("Expected net deposited:");
      expect(stderr).toContain("Auto-withdrawal:");
      expect(stderr).toContain(
        "The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding.",
      );
      expect(stderr).toContain("Privacy delay: Off (no added hold)");
      expect(stderr).toContain(
        "Privacy delay is disabled for this saved flow.",
      );
      expect(stderr).toContain("Wallet setup:");
      expect(stderr).toContain("\n");
      expect(readFileSync(promptedBackupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
    } finally {
      restoreTimers();
    }
  });

  test("interactive new-wallet flows can cancel at the shared flow review prompt", async () => {
    setPromptResponses({ confirm: false });
    state.currentSignerPrivateKey = null;

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: false,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Flow cancelled.");

    const secretFiles = existsSync(realConfig.getWorkflowSecretsDir())
      ? readdirSync(realConfig.getWorkflowSecretsDir())
      : [];
    expect(secretFiles).toHaveLength(0);
  });

  test("interactive new-wallet flows stop when backup confirmation is declined", async () => {
    setPromptResponses({ confirm: [true, false] });
    state.currentSignerPrivateKey = null;

    const { stdout, stderr } = await captureAsyncOutput(async () => {
      await expect(
        startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          newWallet: true,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: true,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        }),
      ).rejects.toThrow("You must confirm that the workflow wallet is backed up.");
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("Private key:");
    expect(stderr).toContain(NEW_WALLET_PRIVATE_KEY);
  });

  test("ragequitWorkflow rejects workflows that have not deposited publicly yet", async () => {
    writeWorkflowSnapshot("wf-no-deposit", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      aspStatus: undefined,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-no-deposit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("This workflow has not deposited publicly yet.");
  });

  test("ragequitWorkflow rejects workflows that are already terminal", async () => {
    writeWorkflowSnapshot("wf-terminal", {
      phase: "completed_public_recovery",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-terminal",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("This workflow is already terminal.");
  });

  test("ragequitWorkflow rejects workflows with an in-flight relayed withdrawal", async () => {
    writeWorkflowSnapshot("wf-inflight-withdrawal", {
      phase: "withdrawing",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-inflight-withdrawal",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).rejects.toThrow("A relayed withdrawal is already in flight for this workflow.");
  });
});
