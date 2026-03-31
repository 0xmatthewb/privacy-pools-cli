/**
 * Output renderer for the `deposit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, prompts, and balance checks remain in the
 * command handler.
 */

import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  renderNextSteps,
  printJsonSuccess,
  success,
  info,
  warn,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import { formatAmount, formatTxHash, displayDecimals } from "../utils/format.js";
import { isTestnetChain, POA_PORTAL_URL } from "../config/chains.js";

export interface DepositDryRunData {
  chain: string;
  asset: string;
  amount: bigint;
  decimals: number;
  poolAccountNumber: number;
  poolAccountId: string;
  precommitment: bigint;
  balanceSufficient: boolean | "unknown";
}

export interface DepositSuccessData {
  txHash: string;
  amount: bigint;
  committedValue: bigint | undefined;
  asset: string;
  chain: string;
  decimals: number;
  poolAccountNumber: number;
  poolAccountId: string;
  poolAddress: string;
  scope: bigint;
  label: bigint | undefined;
  blockNumber: bigint;
  explorerUrl: string | null;
  /** True when the user explicitly passed --chain (overriding the default). */
  chainOverridden?: boolean;
}

/**
 * Render deposit dry-run output.
 *
 * Prints a human-readable summary of what would happen without submitting.
 */
export function renderDepositDryRun(ctx: OutputContext, data: DepositDryRunData): void {
  guardCsvUnsupported(ctx, "deposit --dry-run");

  if (ctx.mode.isJson) {
    printJsonSuccess(
      {
        dryRun: true,
        operation: "deposit",
        chain: data.chain,
        asset: data.asset,
        amount: data.amount.toString(),
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        precommitment: data.precommitment.toString(),
        balanceSufficient: data.balanceSufficient,
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
  const balanceLabel =
    data.balanceSufficient === "unknown"
      ? "unknown (no signer key provided)"
      : data.balanceSufficient
        ? "yes"
        : "no";
  info(`Balance sufficient: ${balanceLabel}`, silent);
}

/**
 * Render deposit success output.
 */
export function renderDepositSuccess(ctx: OutputContext, data: DepositSuccessData): void {
  guardCsvUnsupported(ctx, "deposit");

  const isTestnet = isTestnetChain(data.chain);
  const confirmHint = isTestnet
    ? `re-run accounts --chain ${data.chain}`
    : "re-run accounts";
  const humanConfirmCommand = `privacy-pools accounts --chain ${data.chain}`;
  const agentNextActions = [
    createNextAction(
      "accounts",
      `Poll pending review for ${data.poolAccountId}. When it disappears from pending results, ${confirmHint} to confirm whether it was approved, declined, or needs Proof of Association before choosing withdraw or ragequit.`,
      "after_deposit",
      { options: { agent: true, chain: data.chain, pendingOnly: true } },
    ),
    createNextAction(
      "ragequit",
      `If you decide not to wait for ASP review, ragequit remains available as a public recovery path for ${data.poolAccountId}.`,
      "after_deposit",
      {
        args: [data.asset],
        options: { agent: true, chain: data.chain, fromPa: data.poolAccountId },
      },
    ),
  ];
  const humanNextActions = [
    createNextAction(
      "accounts",
      `Poll pending review for ${data.poolAccountId}. When it disappears from pending results, re-run ${humanConfirmCommand} to confirm whether it was approved, declined, or needs Proof of Association before choosing withdraw or ragequit.`,
      "after_deposit",
      {
        options: { chain: data.chain, pendingOnly: true },
      },
    ),
    createNextAction(
      "ragequit",
      `If ${humanConfirmCommand} later shows ${data.poolAccountId} as declined, or if you decide not to wait for approval, ragequit remains available for public recovery. Complete Proof of Association at ${POA_PORTAL_URL} first if it is required instead.`,
      "after_deposit",
      {
        args: [data.asset],
        options: {
          chain: data.chain,
          fromPa: data.poolAccountId,
        },
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
        operation: "deposit",
        txHash: data.txHash,
        amount: data.amount.toString(),
        committedValue: data.committedValue?.toString() ?? null,
        asset: data.asset,
        chain: data.chain,
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        poolAddress: data.poolAddress,
        scope: data.scope.toString(),
        label: data.label?.toString() ?? null,
        blockNumber: data.blockNumber.toString(),
        explorerUrl: data.explorerUrl,
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const dd = displayDecimals(data.decimals);
  success(`Deposited ${formatAmount(data.amount, data.decimals, data.asset, dd)}.`, silent);
  info(
    "Your deposit is now under review. Most deposits are approved within ~1 hour; some may take longer.",
    silent,
  );
  info(`Pool Account: ${data.poolAccountId}`, silent);
  if (data.committedValue !== undefined) {
    info(
      `Net deposited: ${formatAmount(data.committedValue, data.decimals, data.asset, dd)} (after pool fee)`,
      silent,
    );
  }
  info(`Tx: ${formatTxHash(data.txHash)}`, silent);
  if (data.explorerUrl) {
    info(`Explorer: ${data.explorerUrl}`, silent);
  }
  renderNextSteps(ctx, humanNextActions);
}
