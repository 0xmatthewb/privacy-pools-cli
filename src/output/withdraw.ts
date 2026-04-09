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
import {
  formatAmount,
  formatAddress,
  formatBPS,
  formatDenseOutcomeLine,
  formatTxHash,
  formatUsdValue,
  displayDecimals,
} from "../utils/format.js";
import { inlineSeparator } from "../utils/terminal.js";
import { formatUnits } from "viem";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";
import { formatReviewSurface } from "./review.js";

export interface RelayedWithdrawalReviewData {
  poolAccountId: string;
  poolAccountBalance: bigint;
  amount: bigint;
  asset: string;
  chain: string;
  decimals: number;
  recipient: string;
  quoteFeeBPS: bigint;
  expirationMs: number;
  remainingBalance: bigint;
  extraGasRequested: boolean;
  extraGasFundAmount?: bigint | null;
  tokenPrice?: number | null;
  remainingBelowMinAdvisory?: string | null;
  nowMs?: number;
}

export interface DirectWithdrawalReviewData {
  poolAccountId: string;
  amount: bigint;
  asset: string;
  chain: string;
  decimals: number;
  recipient: string;
  tokenPrice?: number | null;
}

export function formatRelayedWithdrawalReview(
  data: RelayedWithdrawalReviewData,
): string {
  const dd = displayDecimals(data.decimals);
  const usd = (amount: bigint): string => {
    const val = formatUsdValue(amount, data.decimals, data.tokenPrice ?? null);
    return val === "-" ? "" : ` (${val})`;
  };
  const secondsLeft = Math.max(
    0,
    Math.floor((data.expirationMs - (data.nowMs ?? Date.now())) / 1000),
  );
  const feeAmount = (data.amount * data.quoteFeeBPS) / 10000n;
  const netAmount = data.amount - feeAmount;
  const quoteExpiry = `${new Date(data.expirationMs).toISOString()} (in ${secondsLeft}s)`;
  return formatReviewSurface({
    title: "Withdrawal review",
    summaryRows: [
      { label: "Source PA", value: data.poolAccountId },
      {
        label: "PA balance",
        value: formatAmount(
          data.poolAccountBalance,
          data.decimals,
          data.asset,
          dd,
        ),
      },
      {
        label: "Recipient",
        value: formatAddress(data.recipient),
      },
      { label: "Chain", value: data.chain },
      {
        label: "Amount",
        value: `${formatAmount(data.amount, data.decimals, data.asset, dd)}${usd(data.amount)}`,
      },
      {
        label: "Relayer fee",
        value: `${formatAmount(feeAmount, data.decimals, data.asset, dd)}${usd(feeAmount)} (${formatBPS(data.quoteFeeBPS)})`,
        valueTone: "warning",
      },
      ...(data.extraGasFundAmount
        ? [
            {
              label: "Gas token received",
              value: formatAmount(
                data.extraGasFundAmount,
                18,
                "ETH",
                displayDecimals(18),
              ),
              valueTone: "accent" as const,
            },
          ]
        : data.extraGasRequested
          ? [
              {
                label: "Gas token received",
                value: "Requested with the withdrawal",
                valueTone: "accent" as const,
              },
            ]
          : []),
      {
        label: "Net received",
        value: `${formatAmount(netAmount, data.decimals, data.asset, dd)}${usd(netAmount)}`,
        valueTone: "success",
      },
      {
        label: "Remainder",
        value:
          data.remainingBalance === 0n
            ? `${data.poolAccountId} fully withdrawn`
            : `${formatAmount(data.remainingBalance, data.decimals, data.asset, dd)}${usd(data.remainingBalance)}`,
        valueTone:
          data.remainingBalance > 0n && data.remainingBelowMinAdvisory
            ? "danger"
            : "default",
      },
      {
        label: "Quote expiry",
        value: quoteExpiry,
        valueTone: secondsLeft <= 20 ? "warning" : "muted",
      },
    ],
    primaryCallout: {
      kind: "privacy",
      lines: [
        "This uses the relayed privacy-preserving path, so the withdrawal is not tied to your signer address onchain.",
      ],
    },
    secondaryCallout: data.remainingBelowMinAdvisory
      ? {
          kind: "warning",
          lines: data.remainingBelowMinAdvisory,
        }
      : null,
  });
}

export function formatDirectWithdrawalReview(
  data: DirectWithdrawalReviewData,
): string {
  const amountUsd = formatUsdValue(
    data.amount,
    data.decimals,
    data.tokenPrice ?? null,
  );
  return formatReviewSurface({
    title: "Direct withdrawal review",
    summaryRows: [
      { label: "Pool Account", value: data.poolAccountId },
      {
        label: "Amount",
        value:
          `${formatAmount(data.amount, data.decimals, data.asset, displayDecimals(data.decimals))}` +
          (amountUsd === "-" ? "" : ` (${amountUsd})`),
      },
      { label: "Recipient", value: formatAddress(data.recipient) },
      { label: "Chain", value: data.chain },
      {
        label: "Mode",
        value: "Direct (public onchain withdrawal)",
        valueTone: "danger",
      },
    ],
    primaryCallout: {
      kind: "danger",
      lines: [
        "Direct withdrawals publicly link the withdrawal to your signer address.",
        "Use relayed mode instead if you want the privacy-preserving path.",
      ],
    },
  });
}

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

  const actionOptions: Record<string, string | boolean> = {
    agent: true,
    chain: data.chain,
    to: data.recipient,
    fromPa: data.poolAccountId,
  };
  if (data.withdrawMode === "direct") {
    actionOptions.direct = true;
  } else if (data.extraGas !== undefined) {
    actionOptions.extraGas = data.extraGas;
  }

  const agentNextActions = [
    createNextAction(
      "withdraw",
      "Submit the withdrawal for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [formatUnits(data.amount, data.decimals), data.asset],
        options: actionOptions,
      },
    ),
  ];
  const humanActionOptions: Record<string, string | boolean> = {
    chain: data.chain,
    to: data.recipient,
    fromPa: data.poolAccountId,
  };
  if (data.withdrawMode === "direct") {
    humanActionOptions.direct = true;
  } else if (data.extraGas !== undefined) {
    humanActionOptions.extraGas = data.extraGas;
  }
  const humanNextActions = [
    createNextAction(
      "withdraw",
      "Submit the withdrawal for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [formatUnits(data.amount, data.decimals), data.asset],
        options: humanActionOptions,
      },
    ),
  ];

  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      operation: "withdraw",
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
    printJsonSuccess(appendNextActions(payload, agentNextActions), false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Dry-run complete. No transaction was submitted.", silent);
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Mode", value: data.withdrawMode },
        {
          label: "Amount",
          value: formatAmount(
            data.amount,
            data.decimals,
            data.asset,
            displayDecimals(data.decimals),
          ),
        },
        { label: "Recipient", value: formatAddress(data.recipient) },
        { label: "Pool Account", value: data.poolAccountId },
        ...(data.withdrawMode === "relayed" && data.feeBPS
          ? [{ label: "Relayer fee", value: formatBPS(data.feeBPS) }]
          : []),
        ...(data.withdrawMode === "relayed" && data.quoteExpiresAt
          ? [{ label: "Quote expires", value: data.quoteExpiresAt }]
          : []),
        ...(data.withdrawMode === "relayed" && data.extraGas
          ? [{
              label: "Gas token received",
              value: "enabled (receive ETH for gas)",
            }]
          : []),
        {
          label: "Pool Account balance",
          value: formatAmount(
            data.selectedCommitmentValue,
            data.decimals,
            data.asset,
            displayDecimals(data.decimals),
          ),
        },
      ]),
    );
    if (data.withdrawMode === "direct") {
      process.stderr.write(
        formatCallout(
          "privacy",
          "Direct withdrawals are not privacy-preserving. Use relayed mode for private withdrawals.",
        ),
      );
    }
  }
  renderNextSteps(ctx, humanNextActions);
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

  const agentNextActions = [
    createNextAction(
      "accounts",
      `Verify the updated balance for ${data.poolAccountId} after withdrawal.`,
      "after_withdraw",
      { options: { agent: true, chain: data.chain } },
    ),
  ];
  const humanNextActions = [
    createNextAction(
      "accounts",
      `Verify the updated balance for ${data.poolAccountId}.`,
      "after_withdraw",
      { options: data.chain ? { chain: data.chain } : undefined },
    ),
  ];

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
      payload.feeBPS = null;
    } else {
      payload.feeBPS = data.feeBPS;
      if (data.extraGas !== undefined) payload.extraGas = data.extraGas;
    }
    if (data.anonymitySet) payload.anonymitySet = data.anonymitySet;
    printJsonSuccess(appendNextActions(payload, agentNextActions), false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const dd = displayDecimals(data.decimals);
  const usd = (amount: bigint): string => {
    const val = formatUsdValue(amount, data.decimals, data.tokenPrice ?? null);
    return val === "-" ? "" : ` (${val})`;
  };
  if (!silent) {
    const feeBpsNum = data.feeBPS ? Number(data.feeBPS) : null;
    const netAmount = feeBpsNum !== null
      ? data.amount - (data.amount * BigInt(Math.round(feeBpsNum))) / 10000n
      : null;
    process.stderr.write(
      formatDenseOutcomeLine({
        outcome: data.withdrawMode === "direct" ? "success" : "withdraw",
        message:
          `${data.withdrawMode === "direct" ? "Withdrew" : "Withdrew privately"} ` +
          `${formatAmount(data.amount, data.decimals, data.asset, dd)} ` +
          `-> ${formatAddress(data.recipient)}${inlineSeparator()}${data.poolAccountId}${inlineSeparator()}Block ${data.blockNumber.toString()}`,
        url: data.explorerUrl,
      }),
    );
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Mode", value: data.withdrawMode },
        { label: "Pool Account", value: data.poolAccountId },
        { label: "Recipient", value: formatAddress(data.recipient) },
        {
          label: "Amount",
          value: formatAmount(data.amount, data.decimals, data.asset, dd),
        },
        { label: "Tx", value: formatTxHash(data.txHash) },
        ...(data.explorerUrl
          ? [{ label: "Explorer", value: data.explorerUrl }]
          : []),
        ...(data.withdrawMode === "relayed" && data.feeBPS
          ? [{
              label: "Relayer fee",
              value: formatBPS(data.feeBPS),
            }]
          : []),
        ...(netAmount !== null
          ? [{
              label: "You receive",
              value: `~${formatAmount(netAmount, data.decimals, data.asset, dd)}${usd(netAmount)}`,
            }]
          : []),
        ...(data.withdrawMode === "relayed" && data.extraGas
          ? [{
              label: "Gas token received",
              value: "ETH included with withdrawal",
            }]
          : []),
        ...(data.remainingBalance === 0n
          ? [{ label: "Remaining", value: `${data.poolAccountId} fully withdrawn`, valueTone: "success" as const }]
          : [{
              label: `Remaining in ${data.poolAccountId}`,
              value: `${formatAmount(data.remainingBalance, data.decimals, data.asset, dd)}${usd(data.remainingBalance)}`,
            }]),
      ]),
    );
    if (data.withdrawMode === "direct") {
      process.stderr.write(
        formatCallout(
          "danger",
          [
            "This was a direct public withdrawal, so privacy was not preserved.",
            "Use relayed mode next time if you want the privacy-preserving path.",
          ],
        ),
      );
    } else {
      process.stderr.write(
        formatCallout(
          "success",
          "The relayed withdrawal path completed. Re-check accounts if you want to confirm the remaining private balance.",
        ),
      );
    }
  }
  renderNextSteps(ctx, humanNextActions);
}

// ── Quote ────────────────────────────────────────────────────────────────────

export interface WithdrawQuoteData {
  chain: string;
  asset: string;
  amount: bigint;
  decimals: number;
  recipient: string | null;
  minWithdrawAmount: string;
  baseFeeBPS?: string;
  quoteFeeBPS: string;
  feeCommitmentPresent: boolean;
  quoteExpiresAt: string | null;
  tokenPrice: number | null;
  /** Whether extra gas tokens were requested (ERC20 withdrawals only). */
  extraGas?: boolean;
  relayTxCost?: { gas: string; eth: string };
  extraGasFundAmount?: { gas: string; eth: string };
  extraGasTxCost?: { gas: string; eth: string };
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
  const baseFeeBPS = data.baseFeeBPS ?? data.quoteFeeBPS;
  const relayTxCost = data.relayTxCost ?? { gas: "0", eth: "0" };
  const relayTxCostFormatted = formatAmount(
    BigInt(relayTxCost.eth),
    18,
    "ETH",
    displayDecimals(18),
  );
  const extraGasFundFormatted = data.extraGasFundAmount
    ? formatAmount(
        BigInt(data.extraGasFundAmount.eth),
        18,
        "ETH",
        displayDecimals(18),
      )
    : null;
  const extraGasTxCostFormatted = data.extraGasTxCost
    ? formatAmount(
        BigInt(data.extraGasTxCost.eth),
        18,
        "ETH",
        displayDecimals(18),
      )
    : null;

  const usd = (amount: bigint): string => {
    const val = formatUsdValue(amount, data.decimals, data.tokenPrice);
    return val === "-" ? "" : ` (${val})`;
  };

  // When the recipient is missing, the command is a template — not directly runnable.
  // Agents get the full action (with `to: null`) so they know to supply --to.
  // Humans never see non-runnable actions (renderNextSteps filters them out).
  const hasRecipient = data.recipient !== null && data.recipient !== undefined;
  const agentNextActions = [
    createNextAction(
      "withdraw",
      hasRecipient
        ? "Submit the withdrawal promptly if the quoted fee is acceptable."
        : "Supply a --to address and submit the withdrawal.",
      "after_quote",
      {
        args: [formatUnits(data.amount, data.decimals), data.asset],
        options: { agent: true, chain: data.chain, ...(hasRecipient ? { to: data.recipient } : {}), extraGas: data.extraGas ?? null },
        ...(!hasRecipient && { runnable: false }),
      },
    ),
  ];

  // Human: same real args; only include --chain when explicitly overridden.
  // Suppress entirely when the fee makes the withdrawal uneconomical or
  // when the recipient is missing (non-runnable commands are filtered out).
  const humanNextActions = netAmount > 0n && hasRecipient
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
      baseFeeBPS,
      quoteFeeBPS: data.quoteFeeBPS,
      feeAmount: feeAmount.toString(),
      netAmount: netAmount.toString(),
      feeCommitmentPresent: data.feeCommitmentPresent,
      quoteExpiresAt: data.quoteExpiresAt,
      relayTxCost,
    }, agentNextActions) as Record<string, unknown>;
    if (data.extraGas !== undefined) payload.extraGas = data.extraGas;
    if (data.extraGasFundAmount) {
      payload.extraGasFundAmount = data.extraGasFundAmount;
    }
    if (data.extraGasTxCost) {
      payload.extraGasTxCost = data.extraGasTxCost;
    }
    printJsonSuccess(
      payload,
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  if (!silent) {
    const quoteRows = [
      { label: "Asset", value: data.asset },
      {
        label: "Withdraw amount",
        value: `${formatAmount(data.amount, data.decimals, data.asset, dd)}${usd(data.amount)}`,
      },
      {
        label: "Relayer fee",
        value: `${formatAmount(feeAmount, data.decimals, data.asset, dd)}${usd(feeAmount)} (${formatBPS(data.quoteFeeBPS)})`,
      },
      ...(extraGasFundFormatted
        ? [{ label: "Gas token received", value: extraGasFundFormatted }]
        : []),
      {
        label: "You receive",
        value: `~${formatAmount(netAmount, data.decimals, data.asset, dd)}${usd(netAmount)}`,
      },
      { label: "Min withdraw", value: minWithdrawFormatted },
      ...(data.recipient
        ? [{ label: "Recipient", value: formatAddress(data.recipient) }]
        : []),
      ...(data.quoteExpiresAt
        ? (() => {
            const expiresIn = new Date(data.quoteExpiresAt).getTime() - Date.now();
            const expiresLabel = expiresIn > 0
              ? `${Math.ceil(expiresIn / 1000)}s remaining`
              : "expired";
            return [{
              label: "Quote expires",
              value: `${data.quoteExpiresAt} (${expiresLabel})`,
            }];
          })()
        : []),
      ...(data.extraGas && !extraGasFundFormatted
        ? [{
            label: "Gas token received",
            value: "enabled (receive ETH for gas)",
          }]
        : []),
    ];
    process.stderr.write(
      formatSectionHeading("Withdrawal quote", {
        divider: true,
        padTop: false,
      }),
    );
    process.stderr.write(formatKeyValueRows(quoteRows));
  }
  renderNextSteps(ctx, humanNextActions);
}
