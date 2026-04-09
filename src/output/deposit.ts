/**
 * Output renderer for the `deposit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, prompts, and balance checks remain in the
 * command handler.
 */

import chalk from "chalk";
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
  formatDenseOutcomeLine,
  formatTxHash,
  displayDecimals,
} from "../utils/format.js";
import { inlineSeparator } from "../utils/terminal.js";
import { isTestnetChain, POA_PORTAL_URL } from "../config/chains.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "../utils/approval-timing.js";
import { formatUnits } from "viem";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";
import { formatReviewSurface } from "./review.js";
import { formatUsdValue } from "../utils/format.js";

export interface DepositReviewData {
  amount: bigint;
  feeAmount: bigint;
  estimatedCommitted: bigint;
  asset: string;
  chain: string;
  decimals: number;
  tokenPrice?: number | null;
  isErc20?: boolean;
}

function depositUsdSuffix(
  amount: bigint,
  decimals: number,
  tokenPrice?: number | null,
): string {
  const formatted = formatUsdValue(amount, decimals, tokenPrice ?? null);
  return formatted === "-" ? "" : ` (${formatted})`;
}

export function formatDepositReview(data: DepositReviewData): string {
  return formatReviewSurface({
    title: "Deposit review",
    summaryRows: [
      {
        label: "Amount",
        value:
          `${formatAmount(data.amount, data.decimals, data.asset, displayDecimals(data.decimals))}` +
          depositUsdSuffix(data.amount, data.decimals, data.tokenPrice),
      },
      { label: "Chain", value: data.chain },
      {
        label: "Vetting fee",
        value:
          `${formatAmount(data.feeAmount, data.decimals, data.asset, displayDecimals(data.decimals))}` +
          depositUsdSuffix(data.feeAmount, data.decimals, data.tokenPrice),
        valueTone: "warning",
      },
      {
        label: "Net deposited",
        value:
          `~${formatAmount(data.estimatedCommitted, data.decimals, data.asset, displayDecimals(data.decimals))}` +
          depositUsdSuffix(data.estimatedCommitted, data.decimals, data.tokenPrice),
        valueTone: "success",
      },
    ],
    primaryCallout: {
      kind: "privacy",
      lines: [
        "Deposits stay public until ASP review finishes.",
        "Private withdrawal becomes available only after the deposit is approved.",
      ],
    },
    secondaryCallout: data.isErc20
      ? {
          kind: "read-only",
          lines: "This will require 2 transactions: token approval + deposit.",
        }
      : null,
  });
}

export function formatUniqueAmountReview(message: string): string {
  return formatReviewSurface({
    title: "Privacy review",
    primaryCallout: {
      kind: "warning",
      lines: [
        message,
        "Consider a round amount unless you intentionally accept that linkability tradeoff.",
      ],
    },
  });
}

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

  const agentNextActions = [
    createNextAction(
      "deposit",
      "Submit the deposit for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [formatUnits(data.amount, data.decimals), data.asset],
        options: { agent: true, chain: data.chain },
      },
    ),
  ];
  const humanNextActions = [
    createNextAction(
      "deposit",
      "Submit the deposit for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [formatUnits(data.amount, data.decimals), data.asset],
        options: { chain: data.chain },
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
        dryRun: true,
        operation: "deposit",
        chain: data.chain,
        asset: data.asset,
        amount: data.amount.toString(),
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        precommitment: data.precommitment.toString(),
        balanceSufficient: data.balanceSufficient,
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Dry-run complete. No transaction was submitted.", silent);
  if (!silent) {
    const balanceLabel =
      data.balanceSufficient === "unknown"
        ? "unknown (no signer key provided)"
        : data.balanceSufficient
          ? "yes"
          : "no";
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: data.chain },
        { label: "Asset", value: data.asset },
        { label: "Pool Account", value: data.poolAccountId },
        {
          label: "Amount",
          value: formatAmount(
            data.amount,
            data.decimals,
            data.asset,
            displayDecimals(data.decimals),
          ),
        },
        {
          label: "Balance sufficient",
          value: balanceLabel,
          valueTone:
            data.balanceSufficient === true
              ? "success"
              : data.balanceSufficient === false
              ? "warning"
              : "muted",
        },
      ]),
    );
  }
  renderNextSteps(ctx, humanNextActions);
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
      `Poll pending review for ${data.poolAccountId}. When it disappears, ${confirmHint} to confirm whether it was approved, declined, or needs Proof of Association.`,
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
      `Poll pending review for ${data.poolAccountId}. When it disappears, re-run ${humanConfirmCommand} to confirm whether it was approved, declined, or needs Proof of Association.`,
      "after_deposit",
      {
        options: { chain: data.chain, pendingOnly: true },
      },
    ),
    createNextAction(
      "ragequit",
      `If ${humanConfirmCommand} later shows ${data.poolAccountId} as declined, or if you do not want to wait for approval, ragequit remains available for public recovery. Complete Proof of Association at ${POA_PORTAL_URL} first if needed for a private withdrawal instead.`,
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
  if (!silent) {
    process.stderr.write(
      formatDenseOutcomeLine({
        outcome: "deposit",
        message:
          `Deposited ${formatAmount(data.amount, data.decimals, data.asset, dd)} ` +
          `-> ${data.chain} ${data.asset} pool${inlineSeparator()}${data.poolAccountId}${inlineSeparator()}Block ${data.blockNumber.toString()}`,
        url: data.explorerUrl,
      }),
    );
    if (data.poolAccountNumber === 1) {
      process.stderr.write(`  ${chalk.dim("Welcome to the pool.")}\n`);
    }
    const summaryRows = [
      { label: "Chain", value: data.chain },
      { label: "Pool Account", value: data.poolAccountId },
      {
        label: "Amount",
        value: formatAmount(data.amount, data.decimals, data.asset, dd),
      },
      ...(data.committedValue !== undefined
        ? [{
            label: "Net deposited",
            value: `${formatAmount(data.committedValue, data.decimals, data.asset, dd)} (after vetting fee)`,
          }]
        : []),
      { label: "Tx", value: formatTxHash(data.txHash) },
      ...(data.explorerUrl
        ? [{ label: "Explorer", value: data.explorerUrl }]
        : []),
    ];
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(formatKeyValueRows(summaryRows));
    process.stderr.write(
      formatCallout(
        "warning",
        [
          "Your deposit is now under ASP review, so it is still public for the moment.",
          `${DEPOSIT_APPROVAL_TIMELINE_COPY}`,
        ],
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
