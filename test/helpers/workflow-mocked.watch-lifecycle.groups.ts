import { expect, test } from "bun:test";
import {
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { captureAsyncOutput } from "../helpers/output.ts";
import {
  GLOBAL_SIGNER_ADDRESS,
  NEW_WALLET_ADDRESS,
  buildMockRelayerQuote,
  getWorkflowStatus,
  loadWorkflowSnapshot,
  overrideWorkflowTimingForTests,
  realConfig,
  realErrors,
  requestQuoteMock,
  state,
  useImmediateTimers,
  watchWorkflow,
  writeWorkflowSecret,
  writeWorkflowSnapshot,
} from "../helpers/workflow-mocked.harness.ts";

export function registerWorkflowMockedWatchLifecycleTests(): void {
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
        state.aspStatus = "poa_required";
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

        expect(snapshot.phase).toBe("paused_poa_required");
        expect(snapshot.aspStatus).toBe("poa_required");
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
}
