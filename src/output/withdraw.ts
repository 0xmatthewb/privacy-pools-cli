/**
 * Output renderer for the `withdraw` command.
 *
 * Handles dry-run, success, and quote output for both direct
 * and relayed withdrawal modes.
 * Unsigned output, spinners, proof generation, relayer interactions, and
 * prompts remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, success, info, warn, isSilent } from "./common.js";
import { formatAmount, formatAddress, formatTxHash, formatBPS, displayDecimals } from "../utils/format.js";

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
 * Prints a human-readable summary of what would happen without submitting.
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

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Dry-run complete — no transaction was submitted.", silent);
  info(`Mode: ${data.withdrawMode}`, silent);
  info(`Recipient: ${formatAddress(data.recipient)}`, silent);
  info(`Pool Account: ${data.poolAccountId}`, silent);
  if (data.withdrawMode === "relayed" && data.feeBPS) {
    info(`Relay fee: ${formatBPS(data.feeBPS)}`, silent);
    if (data.quoteExpiresAt) info(`Quote expires: ${data.quoteExpiresAt}`, silent);
  }
  info(
    `Pool Account balance: ${formatAmount(data.selectedCommitmentValue, data.decimals, data.asset, displayDecimals(data.decimals))}`,
    silent,
  );
  if (data.withdrawMode === "direct") {
    warn("Direct withdrawals are not privacy-preserving. Use relayed mode (default) for private withdrawals.", silent);
  }
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
      payload.nextStep =
        "Run 'privacy-pools accounts --chain " +
        data.chain +
        "' to verify updated balance. Note: direct withdrawal links deposit and withdrawal onchain.";
    } else {
      payload.feeBPS = data.feeBPS;
      payload.nextStep =
        "Run 'privacy-pools accounts --chain " + data.chain + "' to verify updated balance.";
    }
    printJsonSuccess(payload, false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const dd = displayDecimals(data.decimals);
  success(
    `Withdrew ${formatAmount(data.amount, data.decimals, data.asset, dd)} from ${data.poolAccountId} to ${formatAddress(data.recipient)}.`,
    silent,
  );
  info(`Tx: ${formatTxHash(data.txHash)}`, silent);
  if (data.explorerUrl) {
    info(`Explorer: ${data.explorerUrl}`, silent);
  }
  if (data.withdrawMode === "relayed" && data.feeBPS) {
    const feeBpsNum = Number(data.feeBPS);
    const netAmount = data.amount - (data.amount * BigInt(Math.round(feeBpsNum))) / 10000n;
    info(`Relay fee: ${formatBPS(data.feeBPS)} — net received: ~${formatAmount(netAmount, data.decimals, data.asset, dd)}`, silent);
  }
  if (data.withdrawMode === "direct") {
    warn("Note: Direct withdrawals are not privacy-preserving. Use relayed mode (default) for private withdrawals.", silent);
  }
  info(`Check updated balance: privacy-pools accounts --chain ${data.chain}`, silent);
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
  const dd = displayDecimals(data.decimals);
  const minWithdrawFormatted = formatAmount(
    BigInt(data.minWithdrawAmount),
    data.decimals,
    data.asset,
    dd,
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
  if (!silent) process.stderr.write("\n");
  info("Relayer quote", silent);
  info(`Asset: ${data.asset}`, silent);
  info(`Amount: ${formatAmount(data.amount, data.decimals, data.asset, dd)}`, silent);
  info(`Min withdraw: ${minWithdrawFormatted}`, silent);
  info(`Quoted fee: ${formatBPS(data.quoteFeeBPS)}`, silent);
  info(`Onchain max fee: ${formatBPS(data.maxRelayFeeBPS)}`, silent);
  if (data.recipient) {
    info(`Recipient: ${formatAddress(data.recipient)}`, silent);
  }
  if (data.quoteExpiresAt) {
    info(`Quote expires: ${data.quoteExpiresAt}`, silent);
  }
}
