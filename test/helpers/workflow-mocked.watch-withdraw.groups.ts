import { expect, test } from "bun:test";
import {
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { captureAsyncOutput, expectSilentOutput } from "../helpers/output.ts";
import {
  GLOBAL_SIGNER_ADDRESS,
  NEW_WALLET_ADDRESS,
  buildMockRelayerQuote,
  getWorkflowStatus,
  initializeAccountServiceMock,
  overrideWorkflowTimingForTests,
  proveWithdrawalMock,
  realConfig,
  realWritePrivateFileAtomic,
  refreshExpiredRelayerQuoteForWithdrawalMock,
  requestQuoteMock,
  saveAccountMock,
  state,
  submitRelayRequestMock,
  useImmediateTimers,
  validateRelayerQuoteForWithdrawalMock,
  watchWorkflow,
  writePrivateFileAtomicMock,
  writeWorkflowSecret,
  writeWorkflowSnapshot,
} from "../helpers/workflow-mocked.harness.ts";

export function registerWorkflowMockedWatchWithdrawTests(): void {
      test("watchWorkflow clears new-wallet secrets after a saved public recovery confirms", async () => {
        writeWorkflowSecret("wf-ragequit-watch");
        writeWorkflowSnapshot("wf-ragequit-watch", {
          phase: "paused_poa_required",
          walletMode: "new_wallet",
          walletAddress: NEW_WALLET_ADDRESS,
          aspStatus: "poa_required",
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
          phase: "paused_poa_required",
          walletMode: "configured",
          walletAddress: GLOBAL_SIGNER_ADDRESS,
          aspStatus: "poa_required",
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
          // Use the returned snapshot instead of reloading from disk,
          // since completed workflows are now cleaned up for privacy (B2).
          expect(snapshot.withdrawTxHash).toBe(
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
      test("watchWorkflow fails closed when relayer withdrawal data changes after proof generation", async () => {
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
          }, {
            expirationMs: 9_000,
            feeRecipient: "0x8888888888888888888888888888888888888888",
          }),
          quoteFeeBPS: 50n,
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
        writeWorkflowSnapshot("wf-data-change-after-proof", {
          phase: "awaiting_asp",
          walletMode: "configured",
          walletAddress: GLOBAL_SIGNER_ADDRESS,
          depositBlockNumber: "101",
          aspStatus: "approved",
        });

        await expect(
          watchWorkflow({
            workflowId: "wf-data-change-after-proof",
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
        ).rejects.toThrow("Relayer withdrawal data changed during proof generation.");

        expect(getWorkflowStatus({ workflowId: "wf-data-change-after-proof" }).lastError?.step).toBe(
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
      test("watchWorkflow shows proof verification and relayer submission progress in human mode", async () => {
        writeWorkflowSnapshot("wf-withdraw-human-progress", {
          phase: "awaiting_asp",
          walletMode: "configured",
          walletAddress: GLOBAL_SIGNER_ADDRESS,
          depositBlockNumber: "101",
          aspStatus: "approved",
        });

        let snapshot!: Awaited<ReturnType<typeof watchWorkflow>>;
        const output = await captureAsyncOutput(async () => {
          snapshot = await watchWorkflow({
            workflowId: "wf-withdraw-human-progress",
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
        });

        expect(output.stderr).toContain("Generate and verify withdrawal proof");
        expect(output.stderr).toContain(
          "Generating and locally verifying the withdrawal proof.",
        );
        expect(output.stderr).toContain("Submit withdrawal to relayer");
        expect(output.stderr).toContain(
          "Submitting the signed and verified withdrawal request to the relayer.",
        );
        expect(snapshot.phase).toBe("completed");
        expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
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
}
