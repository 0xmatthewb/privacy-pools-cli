/**
 * Output renderer for the `withdraw` command.
 *
 * Handles dry-run, success, and quote output for both direct
 * and relayed withdrawal modes.
 * Unsigned output, spinners, proof generation, relayer interactions, and
 * prompts remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, success, info, isSilent } from "./common.js";
import { formatAmount, formatAddress, formatTxHash } from "../utils/format.js";

// ── Dry-run ──────────────────────────────────────────────────────────────────

export interface WithdrawDryRunData {
  withdrawMode: "direct" | "relayed";
  amount: bigint;
  asset: string;
  chain: string;
  decimals: number;
  recipient: string;
  poolAccountNumber: number;
  poolAccountId: string;
  selectedCommitmentLabel: bigint;
  selectedCommitmentValue: bigint;
  proofPublicSignals: number;
  /** Relayed-only: fee in basis points. */
  feeBPS?: string;
  /** Relayed-only: ISO timestamp of quote expiration. */
  quoteExpiresAt?: string;
}

/**
 * Render withdraw dry-run output (both direct and relayed).
 *
 * NOTE: Human-mode messages are suppressed by the command's `silent` flag
 * (which includes isDryRun).  Only a bare newline is emitted.
 */
export function renderWithdrawDryRun(ctx: OutputContext, data: WithdrawDryRunData): void {
  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      mode: data.withdrawMode,
      dryRun: true,
      amount: data.amount.toString(),
      asset: data.asset,
      chain: data.chain,
      recipient: data.recipient,
      poolAccountNumber: data.poolAccountNumber,
      poolAccountId: data.poolAccountId,
      selectedCommitmentLabel: data.selectedCommitmentLabel.toString(),
      selectedCommitmentValue: data.selectedCommitmentValue.toString(),
      proofPublicSignals: data.proofPublicSignals,
    };
    if (data.withdrawMode === "relayed") {
      payload.feeBPS = data.feeBPS;
      payload.quoteExpiresAt = data.quoteExpiresAt;
    }
    printJsonSuccess(payload, false);
    return;
  }

  // Human dry-run: messages suppressed by command's `silent` flag.
  process.stderr.write("\n");
  const silent = true; // matches command-level: silent = isQuiet || isJson || isUnsigned || isDryRun
  success("Dry-run complete.", silent);
  info(`Mode: ${data.withdrawMode}`, silent);
  info(`Recipient: ${formatAddress(data.recipient)}`, silent);
  info(`From Pool Account: ${data.poolAccountId}`, silent);
  if (data.withdrawMode === "relayed") {
    info(`Relay fee: ${data.feeBPS} BPS`, silent);
    info(`Quote expires: ${data.quoteExpiresAt}`, silent);
  }
  info(
    `Pool Account balance: ${formatAmount(data.selectedCommitmentValue, data.decimals, data.asset)}`,
    silent,
  );
  info("No transaction was submitted.", silent);
}

// ── Success ──────────────────────────────────────────────────────────────────

export interface WithdrawSuccessData {
  withdrawMode: "direct" | "relayed";
  txHash: string;
  blockNumber: bigint;
  amount: bigint;
  recipient: string;
  asset: string;
  chain: string;
  decimals: number;
  poolAccountNumber: number;
  poolAccountId: string;
  poolAddress: string;
  scope: bigint;
  explorerUrl: string | null;
  /** Relayed-only: fee in basis points. */
  feeBPS?: string;
}

/**
 * Render withdraw success output (both direct and relayed).
 */
export function renderWithdrawSuccess(ctx: OutputContext, data: WithdrawSuccessData): void {
  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      operation: "withdraw",
      mode: data.withdrawMode,
      txHash: data.txHash,
      blockNumber: data.blockNumber.toString(),
      amount: data.amount.toString(),
      recipient: data.recipient,
      withdrawalMode: data.withdrawMode,
      explorerUrl: data.explorerUrl,
      poolAddress: data.poolAddress,
      scope: data.scope.toString(),
      asset: data.asset,
      chain: data.chain,
      poolAccountNumber: data.poolAccountNumber,
      poolAccountId: data.poolAccountId,
    };
    if (data.withdrawMode === "direct") {
      payload.fee = null;
    } else {
      payload.feeBPS = data.feeBPS;
    }
    printJsonSuccess(payload, false);
    return;
  }

  const silent = isSilent(ctx);
  process.stderr.write("\n");
  success(
    `Withdrew ${formatAmount(data.amount, data.decimals, data.asset)} from ${data.poolAccountId} to ${formatAddress(data.recipient)}`,
    silent,
  );
  info(`Tx: ${formatTxHash(data.txHash)}`, silent);
  if (data.explorerUrl) {
    info(`Explorer: ${data.explorerUrl}`, silent);
  }
  if (data.withdrawMode === "relayed") {
    info(`Relay fee: ${data.feeBPS} BPS`, silent);
  }
}

// ── Quote ────────────────────────────────────────────────────────────────────

export interface WithdrawQuoteData {
  chain: string;
  asset: string;
  amount: bigint;
  decimals: number;
  recipient: string | null;
  minWithdrawAmount: string;
  maxRelayFeeBPS: bigint;
  quoteFeeBPS: string;
  feeCommitmentPresent: boolean;
  quoteExpiresAt: string | null;
}

/**
 * Render withdraw quote output.
 */
export function renderWithdrawQuote(ctx: OutputContext, data: WithdrawQuoteData): void {
  const minWithdrawFormatted = formatAmount(
    BigInt(data.minWithdrawAmount),
    data.decimals,
    data.asset,
  );

  if (ctx.mode.isJson) {
    printJsonSuccess(
      {
        mode: "relayed-quote",
        chain: data.chain,
        asset: data.asset,
        amount: data.amount.toString(),
        recipient: data.recipient ?? null,
        minWithdrawAmount: data.minWithdrawAmount,
        minWithdrawAmountFormatted: minWithdrawFormatted,
        maxRelayFeeBPS: data.maxRelayFeeBPS.toString(),
        quoteFeeBPS: data.quoteFeeBPS,
        feeCommitmentPresent: data.feeCommitmentPresent,
        quoteExpiresAt: data.quoteExpiresAt,
      },
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  process.stderr.write("\n");
  success("Relayer quote", silent);
  info(`Asset: ${data.asset}`, silent);
  info(`Amount: ${formatAmount(data.amount, data.decimals, data.asset)}`, silent);
  info(`Min withdraw: ${minWithdrawFormatted}`, silent);
  info(`Quoted fee: ${data.quoteFeeBPS} BPS`, silent);
  info(`On-chain max fee: ${data.maxRelayFeeBPS.toString()} BPS`, silent);
  if (data.recipient) {
    info(`Recipient: ${formatAddress(data.recipient)}`, silent);
  }
  if (data.quoteExpiresAt) {
    info(`Quote expires: ${data.quoteExpiresAt}`, silent);
  }
}
