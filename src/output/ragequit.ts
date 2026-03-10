/**
 * Output renderer for the `ragequit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, proof generation, and prompts remain in the
 * command handler.
 */

import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  printJsonSuccess,
  success,
  info,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import { formatAmount, formatTxHash, displayDecimals } from "../utils/format.js";

export interface RagequitDryRunData {
  chain: string;
  asset: string;
  amount: bigint;
  decimals: number;
  poolAccountNumber: number;
  poolAccountId: string;
  selectedCommitmentLabel: bigint;
  selectedCommitmentValue: bigint;
  proofPublicSignals: number;
}

export interface RagequitSuccessData {
  txHash: string;
  amount: bigint;
  asset: string;
  chain: string;
  decimals: number;
  poolAccountNumber: number;
  poolAccountId: string;
  poolAddress: string;
  scope: bigint;
  blockNumber: bigint;
  explorerUrl: string | null;
}

/**
 * Render ragequit dry-run output.
 *
 * Prints a human-readable summary of what would happen without submitting.
 */
export function renderRagequitDryRun(ctx: OutputContext, data: RagequitDryRunData): void {
  guardCsvUnsupported(ctx, "ragequit --dry-run");

  if (ctx.mode.isJson) {
    printJsonSuccess(
      {
        dryRun: true,
        operation: "ragequit",
        chain: data.chain,
        asset: data.asset,
        amount: data.amount.toString(),
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        selectedCommitmentLabel: data.selectedCommitmentLabel.toString(),
        selectedCommitmentValue: data.selectedCommitmentValue.toString(),
        proofPublicSignals: data.proofPublicSignals,
      },
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Dry-run complete. No transaction was submitted.", silent);
  info(`Chain: ${data.chain}`, silent);
  info(`Asset: ${data.asset}`, silent);
  info(`Pool Account: ${data.poolAccountId}`, silent);
  info(`Amount: ${formatAmount(data.amount, data.decimals, data.asset, displayDecimals(data.decimals))}`, silent);
  info("Privacy note: ragequit is a public, non-private withdrawal that returns funds to your deposit address.", silent);
}

/**
 * Render ragequit success output.
 */
export function renderRagequitSuccess(ctx: OutputContext, data: RagequitSuccessData): void {
  guardCsvUnsupported(ctx, "ragequit");

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
        operation: "ragequit",
        txHash: data.txHash,
        amount: data.amount.toString(),
        asset: data.asset,
        chain: data.chain,
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        poolAddress: data.poolAddress,
        scope: data.scope.toString(),
        blockNumber: data.blockNumber.toString(),
        explorerUrl: data.explorerUrl,
      }, [
        createNextAction(
          "accounts",
          "Verify that the Pool Account is now marked as exited.",
          "after_ragequit",
          {
            options: {
              agent: true,
              chain: data.chain,
            },
          },
        ),
      ]),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success(
    `Ragequit ${data.poolAccountId}: withdrew ${formatAmount(data.amount, data.decimals, data.asset, displayDecimals(data.decimals))} back to deposit address.`,
    silent,
  );
  info(`Tx: ${formatTxHash(data.txHash)}`, silent);
  if (data.explorerUrl) {
    info(`Explorer: ${data.explorerUrl}`, silent);
  }
  info(`Verify account closed: privacy-pools accounts --chain ${data.chain}`, silent);
}
