import type { SubmissionRecord } from "../services/submissions.js";
import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  guardCsvUnsupported,
  isSilent,
  printJsonSuccess,
  renderNextSteps,
  success,
  warn,
} from "./common.js";
import { formatSectionHeading, formatKeyValueRows } from "./layout.js";
import { formatTxHash } from "../utils/format.js";

function buildAgentNextActions(record: SubmissionRecord) {
  if (record.reconciliationRequired) {
    return [
      createNextAction(
        "sync",
        "Reconcile local account state before relying on the confirmed transaction outcome.",
        "after_sync",
        { options: { agent: true, chain: record.chain } },
      ),
    ];
  }

  if (record.status === "submitted") {
    return [
      createNextAction(
        "tx-status",
        "Poll the submitted transaction bundle until it confirms or reverts.",
        "after_submit",
        { args: [record.submissionId], options: { agent: true } },
      ),
    ];
  }

  if (record.operation === "deposit" && record.workflowId) {
    return [
      createNextAction(
        "flow status",
        "Review the deposit-review workflow after the onchain transaction confirmed.",
        "after_deposit",
        { args: [record.workflowId], options: { agent: true } },
      ),
    ];
  }

  if (record.operation === "withdraw") {
    return [
      createNextAction(
        "accounts",
        "Check the updated Pool Account state after the withdrawal confirmed.",
        "after_withdraw",
        { options: { agent: true, chain: record.chain } },
      ),
    ];
  }

  if (record.operation === "ragequit") {
    return [
      createNextAction(
        "accounts",
        "Check the updated Pool Account state after the public recovery confirmed.",
        "after_ragequit",
        { options: { agent: true, chain: record.chain } },
      ),
    ];
  }

  return undefined;
}

function buildHumanNextActions(record: SubmissionRecord) {
  if (record.reconciliationRequired) {
    return [
      createNextAction(
        "sync",
        "Reconcile local account state before relying on the confirmed transaction outcome.",
        "after_sync",
        { options: { chain: record.chain } },
      ),
    ];
  }

  if (record.status === "submitted") {
    return [
      createNextAction(
        "tx-status",
        "Check whether the submitted transaction bundle has confirmed yet.",
        "after_submit",
        { args: [record.submissionId] },
      ),
    ];
  }

  if (record.operation === "deposit" && record.workflowId) {
    return [
      createNextAction(
        "flow status",
        "Review the deposit-review workflow after the onchain transaction confirmed.",
        "after_deposit",
        { args: [record.workflowId] },
      ),
    ];
  }

  if (record.operation === "withdraw") {
    return [
      createNextAction(
        "accounts",
        "Check the updated Pool Account state after the withdrawal confirmed.",
        "after_withdraw",
        { options: { chain: record.chain } },
      ),
    ];
  }

  if (record.operation === "ragequit") {
    return [
      createNextAction(
        "accounts",
        "Check the updated Pool Account state after the public recovery confirmed.",
        "after_ragequit",
        { options: { chain: record.chain } },
      ),
    ];
  }

  return undefined;
}

export function renderTxStatus(
  ctx: OutputContext,
  record: SubmissionRecord,
): void {
  guardCsvUnsupported(ctx, "tx-status");
  const agentNextActions = buildAgentNextActions(record);
  const humanNextActions = buildHumanNextActions(record);

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
        operation: "tx-status",
        submissionId: record.submissionId,
        sourceOperation: record.operation,
        sourceCommand: record.sourceCommand,
        chain: record.chain,
        asset: record.asset ?? null,
        poolAccountId: record.poolAccountId ?? null,
        poolAccountNumber: record.poolAccountNumber ?? null,
        workflowId: record.workflowId ?? null,
        recipient: record.recipient ?? null,
        broadcastMode: record.broadcastMode ?? null,
        broadcastSourceOperation: record.broadcastSourceOperation ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        status: record.status,
        reconciliationRequired: record.reconciliationRequired ?? false,
        localStateSynced: record.localStateSynced ?? false,
        warningCode: record.warningCode ?? null,
        lastError: record.lastError ?? null,
        transactions: record.transactions,
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (record.status === "submitted") {
    warn(
      `Submission ${record.submissionId} is still waiting for confirmation.`,
      silent,
    );
  } else if (record.status === "confirmed") {
    success(
      `Submission ${record.submissionId} confirmed on ${record.chain}.`,
      silent,
    );
  } else {
    warn(
      `Submission ${record.submissionId} reverted on ${record.chain}.`,
      silent,
    );
  }

  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Submission", value: record.submissionId },
        { label: "Operation", value: record.sourceCommand },
        { label: "Chain", value: record.chain },
        { label: "Status", value: record.status },
        ...(record.workflowId ? [{ label: "Workflow", value: record.workflowId }] : []),
        ...(record.poolAccountId ? [{ label: "Pool Account", value: record.poolAccountId }] : []),
      ]),
    );
    process.stderr.write(formatSectionHeading("Transactions", { divider: true }));
    process.stderr.write(
      formatKeyValueRows(
        record.transactions.flatMap((transaction) => [
          {
            label: `${transaction.index + 1}. ${transaction.description}`,
            value: formatTxHash(transaction.txHash),
          },
          {
            label: `   status`,
            value: transaction.blockNumber
              ? `${transaction.status} (block ${transaction.blockNumber})`
              : transaction.status,
          },
          ...(transaction.explorerUrl
            ? [{ label: "   explorer", value: transaction.explorerUrl }]
            : []),
        ]),
      ),
    );
  }

  renderNextSteps(ctx, humanNextActions);
}
