/**
 * Output renderer for the `withdraw` command.
 *
 * Handles dry-run, success, and quote output for both direct
 * and relayed withdrawal modes.
 * Unsigned output, spinners, proof generation, relayer interactions, and
 * prompts remain in the command handler.
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
import { formatAmount, formatAddress, formatTxHash, formatBPS, formatUsdValue, displayDecimals } from "../utils/format.js";
import { formatUnits } from "viem";

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
  /** Whether extra gas tokens were requested (ERC20 withdrawals only). */
  extraGas?: boolean;
  /** Anonymity set info (non-fatal, may be absent if ASP unreachable). */
  anonymitySet?: { eligible: number; total: number; percentage: number };
}

/**
 * Render withdraw dry-run output (both direct and relayed).
 *
 * Prints a human-readable summary of what would happen without submitting.
 */
export function renderWithdrawDryRun(ctx: OutputContext, data: WithdrawDryRunData): void {
  guardCsvUnsupported(ctx, "withdraw --dry-run");

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
      if (data.extraGas !== undefined) payload.extraGas = data.extraGas;
    }
    if (data.anonymitySet) payload.anonymitySet = data.anonymitySet;
    printJsonSuccess(payload, false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Dry-run complete. No transaction was submitted.", silent);
  info(`Mode: ${data.withdrawMode}`, silent);
  info(`Recipient: ${formatAddress(data.recipient)}`, silent);
  info(`Pool Account: ${data.poolAccountId}`, silent);
  if (data.withdrawMode === "relayed" && data.feeBPS) {
    info(`Relayer fee: ${formatBPS(data.feeBPS)}`, silent);
    if (data.quoteExpiresAt) info(`Quote expires: ${data.quoteExpiresAt}`, silent);
  }
  if (data.withdrawMode === "relayed" && data.extraGas) {
    info("Gas token drop: enabled (receive ETH for gas)", silent);
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
  /** Whether extra gas tokens were requested (ERC20 withdrawals only). */
  extraGas?: boolean;
  /** Remaining balance in the Pool Account after withdrawal. */
  remainingBalance: bigint;
  /** Token price in USD, if available. */
  tokenPrice?: number | null;
  /** Anonymity set info (non-fatal, may be absent if ASP unreachable). */
  anonymitySet?: { eligible: number; total: number; percentage: number };
}

/**
 * Render withdraw success output (both direct and relayed).
 */
export function renderWithdrawSuccess(ctx: OutputContext, data: WithdrawSuccessData): void {
  guardCsvUnsupported(ctx, "withdraw");

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
      remainingBalance: data.remainingBalance.toString(),
    };
    if (data.withdrawMode === "direct") {
      payload.fee = null;
    } else {
      payload.feeBPS = data.feeBPS;
      if (data.extraGas !== undefined) payload.extraGas = data.extraGas;
    }
    if (data.anonymitySet) payload.anonymitySet = data.anonymitySet;
    printJsonSuccess(payload, false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const dd = displayDecimals(data.decimals);
  const usd = (amount: bigint): string => {
    const val = formatUsdValue(amount, data.decimals, data.tokenPrice ?? null);
    return val === "-" ? "" : ` (${val})`;
  };
  success(
    `Withdrew ${formatAmount(data.amount, data.decimals, data.asset, dd)} from ${data.poolAccountId} to ${formatAddress(data.recipient)}.`,
    silent,
  );
  if (data.withdrawMode === "direct") {
    warn(
      "Privacy note: direct withdrawals are not private and link the deposit and withdrawal onchain.",
      silent,
    );
  }
  info(`Tx: ${formatTxHash(data.txHash)}`, silent);
  if (data.explorerUrl) {
    info(`Explorer: ${data.explorerUrl}`, silent);
  }
  if (data.withdrawMode === "relayed" && data.feeBPS) {
    const feeBpsNum = Number(data.feeBPS);
    const netAmount = data.amount - (data.amount * BigInt(Math.round(feeBpsNum))) / 10000n;
    info(`Relayer fee: ${formatBPS(data.feeBPS)}. Net received: ~${formatAmount(netAmount, data.decimals, data.asset, dd)}${usd(netAmount)}`, silent);
  }
  if (data.withdrawMode === "relayed" && data.extraGas) {
    info("Gas token drop: enabled (ETH included with withdrawal)", silent);
  }
  if (data.remainingBalance === 0n) {
    info(`${data.poolAccountId} fully withdrawn`, silent);
  } else {
    info(`Remaining in ${data.poolAccountId}: ${formatAmount(data.remainingBalance, data.decimals, data.asset, dd)}${usd(data.remainingBalance)}`, silent);
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
  quoteFeeBPS: string;
  feeCommitmentPresent: boolean;
  quoteExpiresAt: string | null;
  tokenPrice: number | null;
  /** Whether extra gas tokens were requested (ERC20 withdrawals only). */
  extraGas?: boolean;
  /** True when the user explicitly passed --chain (overriding the default). */
  chainOverridden?: boolean;
}

/**
 * Render withdraw quote output.
 */
export function renderWithdrawQuote(ctx: OutputContext, data: WithdrawQuoteData): void {
  guardCsvUnsupported(ctx, "withdraw quote");

  const dd = displayDecimals(data.decimals);
  const minWithdrawFormatted = formatAmount(
    BigInt(data.minWithdrawAmount),
    data.decimals,
    data.asset,
    dd,
  );

  const feeBPS = BigInt(data.quoteFeeBPS);
  const feeAmount = (data.amount * feeBPS) / 10000n;
  const netAmount = data.amount - feeAmount;

  const usd = (amount: bigint): string => {
    const val = formatUsdValue(amount, data.decimals, data.tokenPrice);
    return val === "-" ? "" : ` (${val})`;
  };

  const agentNextActions = [
    createNextAction(
      "withdraw",
      "Submit the withdrawal promptly if the quoted fee is acceptable.",
      "after_quote",
      {
        args: [formatUnits(data.amount, data.decimals), data.asset],
        options: { agent: true, chain: data.chain, to: data.recipient, extraGas: data.extraGas ?? null },
      },
    ),
  ];

  // Human: same real args; only include --chain when explicitly overridden.
  // Suppress entirely when the fee makes the withdrawal uneconomical.
  const humanNextActions = netAmount > 0n
    ? [
        createNextAction(
          "withdraw",
          "Submit the withdrawal promptly if the quoted fee is acceptable.",
          "after_quote",
          {
            args: [formatUnits(data.amount, data.decimals), data.asset],
            options: {
              ...(data.chainOverridden ? { chain: data.chain } : {}),
              to: data.recipient,
              extraGas: data.extraGas ?? null,
            },
          },
        ),
      ]
    : [];

  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = appendNextActions({
      mode: "relayed-quote",
      chain: data.chain,
      asset: data.asset,
      amount: data.amount.toString(),
      recipient: data.recipient ?? null,
      minWithdrawAmount: data.minWithdrawAmount,
      minWithdrawAmountFormatted: minWithdrawFormatted,
      quoteFeeBPS: data.quoteFeeBPS,
      feeAmount: feeAmount.toString(),
      netAmount: netAmount.toString(),
      feeCommitmentPresent: data.feeCommitmentPresent,
      quoteExpiresAt: data.quoteExpiresAt,
    }, agentNextActions) as Record<string, unknown>;
    if (data.extraGas !== undefined) payload.extraGas = data.extraGas;
    printJsonSuccess(
      payload,
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  info("Withdrawal quote:", silent);
  info(`Asset: ${data.asset}`, silent);
  info(`Amount: ${formatAmount(data.amount, data.decimals, data.asset, dd)}${usd(data.amount)}`, silent);
  info(`Relayer fee: ${formatBPS(data.quoteFeeBPS)} (${formatAmount(feeAmount, data.decimals, data.asset, dd)}${usd(feeAmount)})`, silent);
  info(`You receive: ~${formatAmount(netAmount, data.decimals, data.asset, dd)}${usd(netAmount)}`, silent);
  info(`Min withdraw: ${minWithdrawFormatted}`, silent);
  if (data.recipient) {
    info(`Recipient: ${formatAddress(data.recipient)}`, silent);
  }
  if (data.quoteExpiresAt) {
    const expiresIn = new Date(data.quoteExpiresAt).getTime() - Date.now();
    const expiresLabel = expiresIn > 0
      ? `${Math.ceil(expiresIn / 1000)}s remaining`
      : "expired";
    info(`Quote expires: ${data.quoteExpiresAt} (${expiresLabel})`, silent);
  }
  if (data.extraGas) {
    info("Gas token drop: enabled (receive ETH for gas)", silent);
  }
  renderNextSteps(ctx, humanNextActions);
}
