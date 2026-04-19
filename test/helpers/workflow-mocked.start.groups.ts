import { expect, test } from "bun:test";
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
  NEW_WALLET_ADDRESS,
  NEW_WALLET_PRIVATE_KEY,
  depositEthMock,
  failWorkflowSnapshotWriteOnCall,
  loadWorkflowSnapshot,
  realConfig,
  saveAccountMock,
  startWorkflow,
  state,
  useImmediateTimers,
  watchWorkflow,
} from "../helpers/workflow-mocked.harness.ts";

export function registerWorkflowMockedStartTests(): void {
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
    test("configured deposits mark reconciliation required when receipt metadata cannot be recovered", async () => {
      state.depositConfirmationMode = "missing_metadata";

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

      expect(snapshot.phase).toBe("awaiting_asp");
      expect(snapshot.depositLabel).toBeNull();
      expect(snapshot.committedValue).toBeNull();
      expect(snapshot.reconciliationRequired).toBe(true);
      expect(snapshot.localStateSynced).toBe(false);
      expect(snapshot.warningCode).toBe("LOCAL_STATE_RECONCILIATION_REQUIRED");
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
    test("new-wallet ERC20 flow returns a funding snapshot in agent mode without auto-watching", async () => {
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

        expect(snapshot.phase).toBe("awaiting_funding");
        expect(snapshot.walletMode).toBe("new_wallet");
        expect(snapshot.walletAddress).toBe(NEW_WALLET_ADDRESS);
        expect(snapshot.requiredTokenFunding).toBe("100000000");
        expect(state.loadPrivateKeyCalls).toBe(0);
        expect(state.approveErc20Calls).toBe(0);
        expect(state.depositErc20Calls).toBe(0);
        expect(state.requestQuoteCalls).toHaveLength(0);
        expect(readFileSync(backupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
        expect(statSync(backupPath).mode & 0o777).toBe(0o600);
        expect(
          existsSync(
            join(realConfig.getWorkflowSecretsDir(), `${snapshot.workflowId}.json`),
          ),
        ).toBe(true);
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
}
