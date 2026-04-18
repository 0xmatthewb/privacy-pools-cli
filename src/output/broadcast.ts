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
  submittedBy?: string;
  transactions: Array<{
    index: number;
    description: string;
    txHash: string;
    blockNumber: string;
    explorerUrl: string | null;
    status: "confirmed";
  }>;
  localStateUpdated: false;
}

function broadcastNextActions(
  data: BroadcastRenderData,
  agent: boolean,
) {
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
  const nextActions = broadcastNextActions(data, ctx.mode.isJson);

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({ ...data }, nextActions), false);
    return;
  }

  const silent = isSilent(ctx);
  const transactionLabel =
    data.transactions.length === 1 ? "transaction" : "transactions";
  success(
    `Broadcast complete: ${data.transactions.length} ${transactionLabel} confirmed on ${data.chain}.`,
    silent,
  );

  info(
    `Mode: ${data.broadcastMode}${inlineSeparator}Source: ${data.sourceOperation}`,
    silent,
  );
  if (data.submittedBy) {
    info(`Submitted by: ${data.submittedBy}`, silent);
  }

  for (const transaction of data.transactions) {
    const suffix = transaction.explorerUrl
      ? `${inlineSeparator}${transaction.explorerUrl}`
      : "";
    info(
      `${transaction.index + 1}. ${transaction.description}${inlineSeparator}${formatTxHash(transaction.txHash)}${inlineSeparator}block ${transaction.blockNumber}${suffix}`,
      silent,
    );
  }

  renderNextSteps(ctx, nextActions);
}
