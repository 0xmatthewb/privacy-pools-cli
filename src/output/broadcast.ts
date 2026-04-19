import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  guardCsvUnsupported,
  info,
  isSilent,
  printJsonSuccess,
  renderNextSteps,
  success,
} from "./common.js";
import { formatTxHash } from "../utils/format.js";
import { inlineSeparator } from "../utils/terminal.js";

export interface BroadcastRenderData {
  mode: "broadcast";
  broadcastMode: "onchain" | "relayed";
  sourceOperation: "deposit" | "withdraw" | "ragequit";
  chain: string;
  submissionId?: string | null;
  validatedOnly?: boolean;
  submittedBy?: string;
  transactions: Array<{
    index: number;
    description: string;
    txHash: string | null;
    blockNumber: string | null;
    explorerUrl: string | null;
    status: "submitted" | "confirmed" | "validated";
  }>;
  localStateUpdated: false;
}

function broadcastNextActions(
  data: BroadcastRenderData,
  agent: boolean,
) {
  const hasSubmittedTransactions = data.transactions.some(
    (transaction) => transaction.status === "submitted",
  );

  if (hasSubmittedTransactions) {
    return [
      createNextAction(
        "tx-status",
        "Poll the submitted broadcast bundle until it confirms.",
        "after_submit",
        {
          ...(data.submissionId ? { args: [data.submissionId] } : {}),
          ...(agent ? { options: { agent: true } } : {}),
          ...(data.submissionId
            ? {}
            : {
                parameters: [
                  { name: "submissionId", type: "submission_id", required: true },
                ],
                runnable: false,
              }),
        },
      ),
    ];
  }

  switch (data.sourceOperation) {
    case "deposit":
      return [
        createNextAction(
          "accounts",
          "Monitor ASP review for the newly deposited Pool Account.",
          "after_deposit",
          {
            options: agent
              ? { agent: true, chain: data.chain, pendingOnly: true }
              : { chain: data.chain, pendingOnly: true },
          },
        ),
      ];
    case "withdraw":
      return [
        createNextAction(
          "accounts",
          "Refresh Pool Account balances after the withdrawal confirmed.",
          "after_withdraw",
          {
            options: agent
              ? { agent: true, chain: data.chain }
              : { chain: data.chain },
          },
        ),
      ];
    case "ragequit":
      return [
        createNextAction(
          "accounts",
          "Refresh Pool Account status after the public recovery confirmed.",
          "after_ragequit",
          {
            options: agent
              ? { agent: true, chain: data.chain }
              : { chain: data.chain },
          },
        ),
      ];
  }
}

export function renderBroadcast(
  ctx: OutputContext,
  data: BroadcastRenderData,
): void {
  guardCsvUnsupported(ctx, "broadcast");
  const nextActions = data.validatedOnly
    ? undefined
    : broadcastNextActions(data, ctx.mode.isJson);

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({ ...data }, nextActions), false);
    return;
  }

  const silent = isSilent(ctx);
  const transactionLabel =
    data.transactions.length === 1 ? "transaction" : "transactions";
  success(
    data.validatedOnly
      ? `Broadcast validation complete: ${data.transactions.length} ${transactionLabel} checked for ${data.chain}. No transaction was submitted.`
      : data.transactions.some((transaction) => transaction.status === "submitted")
      ? `Broadcast submission complete: ${data.transactions.length} ${transactionLabel} accepted on ${data.chain}.`
      : `Broadcast complete: ${data.transactions.length} ${transactionLabel} confirmed on ${data.chain}.`,
    silent,
  );

  info(
    `Mode: ${data.broadcastMode}${inlineSeparator}Source: ${data.sourceOperation}`,
    silent,
  );
  if (data.submittedBy) {
    info(
      data.validatedOnly
        ? `Validated signer: ${data.submittedBy}`
        : `Submitted by: ${data.submittedBy}`,
      silent,
    );
  }

  for (const transaction of data.transactions) {
    if (data.validatedOnly) {
      info(
        `${transaction.index + 1}. ${transaction.description}${inlineSeparator}validated only`,
        silent,
      );
      continue;
    }

    const suffix = transaction.explorerUrl
      ? `${inlineSeparator}${transaction.explorerUrl}`
      : "";
    info(
      `${transaction.index + 1}. ${transaction.description}${inlineSeparator}${formatTxHash(transaction.txHash!)}${inlineSeparator}${transaction.blockNumber ? `block ${transaction.blockNumber}` : transaction.status}${suffix}`,
      silent,
    );
  }

  renderNextSteps(ctx, nextActions);
}
