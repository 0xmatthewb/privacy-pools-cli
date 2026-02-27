/**
 * Output renderer for the `ragequit` command.
 *
 * Phase 4 – handles dry-run and success output.
 * Unsigned output, spinners, proof generation, and prompts remain in the
 * command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, success, info, isSilent } from "./common.js";
import { formatAmount, formatTxHash } from "../utils/format.js";

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
 * NOTE: Same silent-flag behavior as deposit – human-mode messages are
 * suppressed because the command's `silent` includes `isDryRun`.
 */
export function renderRagequitDryRun(ctx: OutputContext, data: RagequitDryRunData): void {
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

  // Human dry-run: messages suppressed by command's `silent` flag.
  process.stderr.write("\n");
  const silent = true; // matches command-level: silent = isQuiet || isJson || isUnsigned || isDryRun
  success("Dry-run complete.", silent);
  info(`Chain: ${data.chain}`, silent);
  info(`Asset: ${data.asset}`, silent);
  info(`Pool Account: ${data.poolAccountId}`, silent);
  info(`Amount: ${formatAmount(data.amount, data.decimals, data.asset)}`, silent);
  info("Privacy note: this exit returns funds without privacy.", silent);
  info("No transaction was submitted.", silent);
}

/**
 * Render ragequit success output.
 */
export function renderRagequitSuccess(ctx: OutputContext, data: RagequitSuccessData): void {
  if (ctx.mode.isJson) {
    printJsonSuccess(
      {
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
      },
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  process.stderr.write("\n");
  success(
    `Exited ${data.poolAccountId} and recovered ${formatAmount(data.amount, data.decimals, data.asset)}`,
    silent,
  );
  info(`Tx: ${formatTxHash(data.txHash)}`, silent);
  if (data.explorerUrl) {
    info(`Explorer: ${data.explorerUrl}`, silent);
  }
}
