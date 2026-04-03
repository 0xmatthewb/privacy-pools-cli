import { expect, test } from "bun:test";
import {
  existsSync,
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
  failWorkflowSnapshotWriteOnCall,
  getDataServiceMock,
  getWorkflowStatus,
  publicClient,
  ragequitWorkflow,
  realConfig,
  resolvePoolMock,
  saveAccountMock,
  state,
  submitRelayRequestMock,
  watchWorkflow,
  writeWorkflowSecret,
  writeWorkflowSnapshot,
} from "../helpers/workflow-mocked.harness.ts";
import { WORKFLOW_SECRET_RECORD_VERSION } from "../../src/services/workflow-storage-version.ts";

export function registerWorkflowMockedRagequitTests(): void {
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
      expect(resolvePoolMock).toHaveBeenCalledTimes(1);
      expect(getDataServiceMock).toHaveBeenCalledTimes(1);
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
}
