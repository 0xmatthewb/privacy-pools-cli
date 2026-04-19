import type { Hash as SDKHash } from "@0xbow/privacy-pools-core-sdk";
import type { Command } from "commander";
import { createOutputContext } from "../output/common.js";
import {
  initializeAccountService,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { renderTxStatus } from "../output/tx-status.js";
import { persistWithReconciliation } from "../services/persist-with-reconciliation.js";
import { resolvePool } from "../services/pools.js";
import { getDataService } from "../services/sdk.js";
import {
  refreshSubmissionRecord,
  updateSubmissionRecord,
  type SubmissionRecord,
} from "../services/submissions.js";
import { loadMnemonic } from "../services/wallet.js";
import {
  alignSnapshotToPoolAccount,
  clearLastError,
  loadWorkflowSnapshot,
  pickWorkflowPoolAccount,
  saveWorkflowSnapshotIfChanged,
  updateSnapshot,
} from "../services/workflow.js";
import type { GlobalOptions } from "../types.js";
import { buildAllPoolAccountRefs } from "../utils/pool-accounts.js";
import { printError } from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { resolveChain } from "../utils/validation.js";

export { createTxStatusCommand } from "../command-shells/tx-status.js";

const LOCAL_STATE_RECONCILIATION_WARNING_CODE =
  "LOCAL_STATE_RECONCILIATION_REQUIRED";

type SubmissionSourceOperation = "deposit" | "withdraw" | "ragequit";

function getSubmissionSourceOperation(
  record: SubmissionRecord,
): SubmissionSourceOperation | null {
  if (record.operation === "broadcast") {
    return record.broadcastSourceOperation ?? null;
  }
  return record.operation;
}

function getSubmissionActionLabel(
  operation: SubmissionSourceOperation,
): string {
  switch (operation) {
    case "deposit":
      return "Deposit";
    case "withdraw":
      return "Withdrawal";
    case "ragequit":
      return "Ragequit";
  }
}

function getConfirmedPrimaryTransaction(
  record: SubmissionRecord,
  preferredTxHash?: string | null,
) {
  const normalizedPreferredHash = preferredTxHash?.toLowerCase() ?? null;
  if (normalizedPreferredHash) {
    const matchingTransaction = record.transactions.find(
      (transaction) => transaction.txHash.toLowerCase() === normalizedPreferredHash,
    );
    if (matchingTransaction) {
      return matchingTransaction;
    }
  }

  return [...record.transactions]
    .reverse()
    .find((transaction) => transaction.status === "confirmed") ?? null;
}

function ensureRevertedSubmissionError(
  record: SubmissionRecord,
): SubmissionRecord {
  if (record.status !== "reverted" || record.lastError) {
    return record;
  }

  const revertedTransaction = record.transactions.find(
    (transaction) => transaction.status === "reverted",
  ) ?? record.transactions[record.transactions.length - 1];
  return updateSubmissionRecord(record.submissionId, {
    lastError: {
      code: "SUBMISSION_REVERTED",
      message: revertedTransaction
        ? `${revertedTransaction.description} reverted onchain.`
        : "The submitted transaction reverted onchain.",
    },
  });
}

async function syncDepositReviewWorkflow(params: {
  record: SubmissionRecord;
  chainId: number;
  poolScope?: bigint;
  accountService?: Awaited<ReturnType<typeof initializeAccountService>>;
}): Promise<void> {
  if (!params.record.workflowId) {
    return;
  }

  const snapshot = loadWorkflowSnapshot(params.record.workflowId);
  if (snapshot.workflowKind !== "deposit_review") {
    return;
  }

  if (params.record.status === "reverted") {
    const reverted = updateSnapshot(clearLastError(snapshot), {
      phase: "stopped_external",
      reconciliationRequired: false,
      localStateSynced: false,
      warningCode: null,
      lastError: {
        step: "deposit",
        errorCode: "DEPOSIT_REVERTED",
        errorMessage: "The submitted deposit transaction reverted onchain.",
        retryable: false,
        at: new Date().toISOString(),
      },
    });
    saveWorkflowSnapshotIfChanged(snapshot, reverted);
    return;
  }

  const confirmedDeposit = getConfirmedPrimaryTransaction(
    params.record,
    snapshot.depositTxHash,
  );
  let nextSnapshot = updateSnapshot(clearLastError(snapshot), {
    phase: "awaiting_asp",
    aspStatus: "pending",
    depositBlockNumber:
      confirmedDeposit?.blockNumber ?? snapshot.depositBlockNumber ?? null,
    depositExplorerUrl:
      confirmedDeposit?.explorerUrl ?? snapshot.depositExplorerUrl ?? null,
    reconciliationRequired: params.record.reconciliationRequired ?? false,
    localStateSynced: params.record.localStateSynced ?? false,
    warningCode: params.record.warningCode ?? null,
  });

  if (params.accountService && params.poolScope !== undefined) {
    const spendableCommitments = withSuppressedSdkStdoutSync(() =>
      params.accountService!.getSpendableCommitments(),
    );
    const poolAccounts = buildAllPoolAccountRefs(
      params.accountService.account,
      params.poolScope,
      spendableCommitments.get(params.poolScope) ?? [],
    );
    const matchingPoolAccount = pickWorkflowPoolAccount(nextSnapshot, poolAccounts);
    if (matchingPoolAccount) {
      nextSnapshot = alignSnapshotToPoolAccount(
        nextSnapshot,
        params.chainId,
        matchingPoolAccount,
      );
    }
  }

  saveWorkflowSnapshotIfChanged(snapshot, nextSnapshot);
}

async function reconcileConfirmedSubmission(
  record: SubmissionRecord,
  globalOpts: GlobalOptions,
): Promise<SubmissionRecord> {
  const sourceOperation = getSubmissionSourceOperation(record);
  if (record.status === "reverted") {
    const revertedRecord = ensureRevertedSubmissionError(record);
    if (sourceOperation === "deposit" && revertedRecord.workflowId) {
      await syncDepositReviewWorkflow({
        record: revertedRecord,
        chainId: resolveChain(revertedRecord.chain).id,
        poolScope: 0n,
      }).catch(() => undefined);
    }
    return revertedRecord;
  }

  if (
    record.status !== "confirmed" ||
    !sourceOperation ||
    !record.asset ||
    (record.localStateSynced === true &&
      !(sourceOperation === "deposit" && record.workflowId))
  ) {
    return record;
  }

  try {
    const chainConfig = resolveChain(record.chain);
    const pool = await resolvePool(chainConfig, record.asset, globalOpts?.rpcUrl);
    const mnemonic = loadMnemonic();
    const dataService = await getDataService(
      chainConfig,
      pool.pool,
      globalOpts?.rpcUrl,
    );
    const accountService = await initializeAccountService(
      dataService,
      mnemonic,
      [
        {
          chainId: chainConfig.id,
          address: pool.pool,
          scope: pool.scope as unknown as SDKHash,
          deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
        },
      ],
      chainConfig.id,
      true,
      true,
      true,
    );
    const actionLabel = getSubmissionActionLabel(sourceOperation);
    const reconciliation = await persistWithReconciliation({
      accountService,
      chainConfig,
      dataService,
      mnemonic,
      pool,
      silent: true,
      isJson: true,
      isVerbose: globalOpts?.verbose ?? false,
      errorLabel: `${actionLabel} reconciliation`,
      reconcileHint: `Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`,
      persistFailureMessage: `${actionLabel} confirmed onchain but failed to save local state`,
      forceReconciliation: true,
      allowLegacyRecoveryVisibility: sourceOperation === "ragequit",
      warningCode: LOCAL_STATE_RECONCILIATION_WARNING_CODE,
    });
    const reconciledRecord = updateSubmissionRecord(record.submissionId, {
      reconciliationRequired: reconciliation.reconciliationRequired,
      localStateSynced: reconciliation.localStateSynced,
      warningCode: reconciliation.warningCode,
      lastError: null,
    });

    if (sourceOperation === "deposit" && reconciledRecord.workflowId) {
      await syncDepositReviewWorkflow({
        record: reconciledRecord,
        chainId: chainConfig.id,
        poolScope: pool.scope,
        accountService,
      });
    }

    return reconciledRecord;
  } catch (error) {
    return updateSubmissionRecord(record.submissionId, {
      reconciliationRequired: true,
      localStateSynced: false,
      warningCode: LOCAL_STATE_RECONCILIATION_WARNING_CODE,
      lastError: {
        code: "SUBMISSION_RECONCILIATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export async function handleTxStatusCommand(
  submissionId: string,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    const refreshed = await refreshSubmissionRecord(submissionId, {
      rpcUrl: globalOpts?.rpcUrl,
    });
    const record = await reconcileConfirmedSubmission(refreshed, globalOpts);
    renderTxStatus(createOutputContext(mode, globalOpts?.verbose ?? false), record);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
