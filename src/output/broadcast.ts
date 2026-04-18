import type { OutputContext } from "./common.js";
import {
  guardCsvUnsupported,
  info,
  isSilent,
  printJsonSuccess,
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

export function renderBroadcast(
  ctx: OutputContext,
  data: BroadcastRenderData,
): void {
  guardCsvUnsupported(ctx, "broadcast");

  if (ctx.mode.isJson) {
    printJsonSuccess(data, false);
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
}
