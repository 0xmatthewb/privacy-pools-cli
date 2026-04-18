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
  DRY_RUN_FOOTER_COPY,
  renderNextSteps,
  printJsonSuccess,
  success,
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
  formatRemainingTime,
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
  recipientEnsName?: string;
  baseFeeBPS?: bigint;
  quoteFeeBPS: bigint;
  expirationMs: number;
  remainingBalance: bigint;
  extraGasRequested: boolean;
  extraGasFundAmount?: bigint | null;
  relayTxCost?: { gas: string; eth: string } | null;
  extraGasTxCost?: { gas: string; eth: string } | null;
  tokenPrice?: number | null;
  nativeTokenPrice?: number | null;
  remainingBelowMinAdvisory?: string | null;
  nowMs?: number;
  anonymitySet?: { eligible: number; total: number; percentage: number };
}

export interface DirectWithdrawalReviewData {
  poolAccountId: string;
  amount: bigint;
  asset: string;
  chain: string;
  decimals: number;
  recipient: string;
  recipientEnsName?: string;
  tokenPrice?: number | null;
}

export function buildDirectWithdrawalPrivacyCostManifest(data: {
  poolAccountId: string;
  amount: bigint;
  asset: string;
  chain: string;
  recipient: string;
}): Record<string, unknown> {
  return {
    action: "withdraw --direct",
    framing: "public_direct_withdrawal",
    poolAccountId: data.poolAccountId,
    amount: data.amount.toString(),
    asset: data.asset,
    chain: data.chain,
    recipient: data.recipient,
    privacyCost: "direct withdrawal publicly links the deposit and withdrawal addresses onchain",
    privacyPreserved: false,
    recommendation: "Use the default relayed withdrawal path unless you intentionally accept this privacy loss.",
  };
}

export function formatAnonymitySetValue(anonymitySet: {
  eligible: number;
  total: number;
  percentage: number;
}): string {
  return `${anonymitySet.eligible} of ${anonymitySet.total} deposits (${anonymitySet.percentage.toFixed(1)}%; larger is more private)`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatLocalTimestamp(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} local`;
}

function formatHumanQuoteExpiry(expirationMs: number, nowMs: number = Date.now()): {
  label: string;
  secondsLeft: number;
} {
  const secondsLeft = Math.max(0, Math.floor((expirationMs - nowMs) / 1000));
  const remaining = formatRemainingTime(expirationMs, nowMs);
  const localTimestamp = formatLocalTimestamp(expirationMs);
  return {
    label:
      remaining === "expired"
        ? `expired (${localTimestamp})`
        : `in ${remaining} (${localTimestamp})`,
    secondsLeft,
  };
}

function formatNativeGasTokenAmount(
  amount: bigint,
  nativeTokenPrice?: number | null,
): string {
  const formatted = formatAmount(amount, 18, "ETH");
  const usd =
    nativeTokenPrice === undefined || nativeTokenPrice === null
      ? "-"
      : (() => {
          const tokens = Number(formatUnits(amount, 18));
          const value = tokens * nativeTokenPrice;
          return Number.isFinite(value)
            ? `$${value.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`
            : "-";
        })();
  return usd === "-" ? formatted : `${formatted} (${usd})`;
}

export function formatRelayedWithdrawalReview(
  data: RelayedWithdrawalReviewData,
): string {
  const usd = (amount: bigint): string => {
    const val = formatUsdValue(amount, data.decimals, data.tokenPrice ?? null);
    return val === "-" ? "" : ` (${val})`;
  };
  const { label: quoteExpiry, secondsLeft } = formatHumanQuoteExpiry(
    data.expirationMs,
    data.nowMs,
  );
  const feeAmount = (data.amount * data.quoteFeeBPS) / 10000n;
  const baseFeeAmount = (data.amount * (data.baseFeeBPS ?? data.quoteFeeBPS)) / 10000n;
  const netAmount = data.amount - feeAmount;
  const relayTxCostFormatted = data.relayTxCost
    ? formatAmount(BigInt(data.relayTxCost.eth), 18, "ETH")
    : null;
  const extraGasTxCostFormatted = data.extraGasTxCost
    ? formatAmount(BigInt(data.extraGasTxCost.eth), 18, "ETH")
    : null;
  const secondaryLines = [
    ...(data.remainingBelowMinAdvisory ? [data.remainingBelowMinAdvisory] : []),
    ...(secondsLeft <= 30
      ? [
          "This quote is close to expiry. The CLI will refresh before proof generation when it can; if the fee changes, you will need to re-run the withdrawal.",
        ]
      : []),
  ];
  return formatReviewSurface({
    title: "Withdrawal review",
    summaryRows: [
      { label: "Pool Account", value: data.poolAccountId },
      {
        label: "Pool Account balance",
        value: formatAmount(data.poolAccountBalance, data.decimals, data.asset),
      },
      {
        label: "Recipient",
        value: data.recipient,
      },
      ...(data.recipientEnsName
        ? [{ label: "Recipient ENS", value: data.recipientEnsName }]
        : []),
      { label: "Chain", value: data.chain },
      {
        label: "Amount",
        value: `${formatAmount(data.amount, data.decimals, data.asset)}${usd(data.amount)}`,
      },
      {
        label: "Total fee",
        value: `${formatAmount(feeAmount, data.decimals, data.asset)}${usd(feeAmount)} (${formatBPS(data.quoteFeeBPS)} of withdrawal)`,
        valueTone: "warning",
      },
      {
        label: "Relayer fee",
        value: `${formatAmount(baseFeeAmount, data.decimals, data.asset)}${usd(baseFeeAmount)} (${formatBPS(data.baseFeeBPS ?? data.quoteFeeBPS)})`,
        valueTone: "warning",
      },
      ...(relayTxCostFormatted
        ? [
            {
              label: "Blockchain relay cost",
              value: relayTxCostFormatted,
              valueTone: "muted" as const,
            },
          ]
        : []),
      ...(data.extraGasFundAmount
        ? [
            {
              label: "Gas token received",
              value: formatNativeGasTokenAmount(
                data.extraGasFundAmount,
                data.nativeTokenPrice,
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
      ...(extraGasTxCostFormatted
        ? [
            {
              label: "Gas token top-up cost",
              value: extraGasTxCostFormatted,
              valueTone: "muted" as const,
            },
          ]
        : []),
      {
        label: "Net received",
        value: `${formatAmount(netAmount, data.decimals, data.asset)}${usd(netAmount)}`,
        valueTone: "success",
      },
      {
        label: "Remainder",
        value:
          data.remainingBalance === 0n
            ? `${data.poolAccountId} fully withdrawn`
            : `${formatAmount(data.remainingBalance, data.decimals, data.asset)}${usd(data.remainingBalance)}`,
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
      ...(data.anonymitySet
        ? [
            {
              label: "Anonymity set",
              value: formatAnonymitySetValue(data.anonymitySet),
              valueTone: "accent" as const,
            },
          ]
        : []),
    ],
    primaryCallout: {
      kind: "privacy",
      lines: [
        "This uses the relayed privacy-preserving path, so the withdrawal is not tied to your signer address onchain.",
      ],
    },
    secondaryCallout: secondaryLines.length > 0
      ? {
          kind: "warning",
          lines: secondaryLines,
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
          `${formatAmount(data.amount, data.decimals, data.asset)}` +
          (amountUsd === "-" ? "" : ` (${amountUsd})`),
      },
      { label: "Recipient", value: data.recipient },
      ...(data.recipientEnsName
        ? [{ label: "Recipient ENS", value: data.recipientEnsName }]
        : []),
      { label: "Chain", value: data.chain },
      {
        label: "Mode",
        value: "Direct (public onchain withdrawal)",
        valueTone: "danger",
      },
      {
        label: "Privacy cost",
        value: "Public link to signer address",
        valueTone: "danger",
      },
    ],
    primaryCallout: {
      kind: "danger",
      lines: [
        "Direct withdrawals publicly link your deposit and withdrawal addresses onchain.",
        "This cannot be undone. Use the default relayed mode unless you fully accept this privacy loss.",
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
  relayerHost?: string | null;
  quoteRefreshCount?: number;
  /** Whether extra gas tokens were requested (ERC20 withdrawals only). */
  extraGas?: boolean;
  rootMatchedAtProofTime?: boolean;
  /** Anonymity set info (non-fatal, may be absent if ASP unreachable). */
  anonymitySet?: { eligible: number; total: number; percentage: number };
  warnings?: Array<{ code: string; category: string; message: string }>;
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
    poolAccount: data.poolAccountId,
  };
  if (data.withdrawMode === "direct") {
    actionOptions.direct = true;
    actionOptions.yesIUnderstandPrivacyLoss = true;
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
    poolAccount: data.poolAccountId,
  };
  if (data.withdrawMode === "direct") {
    humanActionOptions.direct = true;
    humanActionOptions.yesIUnderstandPrivacyLoss = true;
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
      warnings: [
        {
          code: "PREVIEW_VALIDATION_APPROXIMATE",
          category: "preview",
          message: "Dry-run validation is approximate until the transaction is signed and submitted.",
        },
        ...(data.warnings ?? []),
      ],
    };
    if (data.withdrawMode === "relayed") {
      payload.feeBPS = data.feeBPS;
      payload.quoteExpiresAt = data.quoteExpiresAt;
      payload.relayerHost = data.relayerHost ?? null;
      payload.quoteRefreshCount = data.quoteRefreshCount ?? 0;
      if (data.extraGas !== undefined) payload.extraGas = data.extraGas;
    } else {
      payload.privacyCostManifest = buildDirectWithdrawalPrivacyCostManifest(data);
    }
    payload.rootMatchedAtProofTime = data.rootMatchedAtProofTime ?? true;
    if (data.anonymitySet) payload.anonymitySet = data.anonymitySet;
    printJsonSuccess(appendNextActions(payload, agentNextActions), false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success(DRY_RUN_FOOTER_COPY, silent);
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Mode", value: data.withdrawMode },
        {
          label: "Amount",
          value: formatAmount(data.amount, data.decimals, data.asset),
        },
        { label: "Recipient", value: formatAddress(data.recipient) },
        { label: "Pool Account", value: data.poolAccountId },
        ...(data.withdrawMode === "relayed" && data.feeBPS
          ? [{ label: "Relayer fee", value: formatBPS(data.feeBPS) }]
          : []),
        ...(data.withdrawMode === "relayed" && data.quoteExpiresAt
          ? [{
              label: "Quote expires",
              value: formatHumanQuoteExpiry(new Date(data.quoteExpiresAt).getTime()).label,
            }]
          : []),
        ...(data.withdrawMode === "relayed" && data.relayerHost
          ? [{ label: "Relayer", value: data.relayerHost }]
          : []),
        ...(data.withdrawMode === "relayed" && data.quoteRefreshCount !== undefined
          ? [{ label: "Quote refreshes", value: String(data.quoteRefreshCount) }]
          : []),
        ...(data.withdrawMode === "relayed" && data.extraGas
          ? [{
              label: "Gas token received",
              value: "enabled (receive ETH for gas)",
            }]
          : []),
        ...(data.anonymitySet
          ? [{
              label: "Anonymity set",
              value: formatAnonymitySetValue(data.anonymitySet),
            }]
          : []),
        {
          label: "Pool Account balance",
          value: formatAmount(data.selectedCommitmentValue, data.decimals, data.asset),
        },
      ]),
    );
    if (data.withdrawMode === "direct") {
      process.stderr.write(
        formatCallout(
          "privacy",
          "Direct withdrawals publicly link your deposit and withdrawal addresses onchain. Use relayed mode for private withdrawals.",
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
  relayerHost?: string | null;
  quoteRefreshCount?: number;
  /** Whether extra gas tokens were requested (ERC20 withdrawals only). */
  extraGas?: boolean;
  /** Relayed-only: amount of gas token included with the withdrawal. */
  extraGasFundAmount?: bigint | null;
  /** Native gas token price in USD, if available. */
  nativeTokenPrice?: number | null;
  /** Remaining balance in the Pool Account after withdrawal. */
  remainingBalance: bigint;
  /** Token price in USD, if available. */
  tokenPrice?: number | null;
  /** Anonymity set info (non-fatal, may be absent if ASP unreachable). */
  anonymitySet?: { eligible: number; total: number; percentage: number };
  rootMatchedAtProofTime?: boolean;
  reconciliationRequired?: boolean;
  localStateSynced?: boolean;
  warningCode?: string | null;
  warnings?: Array<{ code: string; category: string; message: string }>;
}

/**
 * Render withdraw success output (both direct and relayed).
 */
export function renderWithdrawSuccess(ctx: OutputContext, data: WithdrawSuccessData): void {
  guardCsvUnsupported(ctx, "withdraw");

  const agentNextActions = [
    ...(data.reconciliationRequired
      ? [
          createNextAction(
            "sync",
            `Reconcile local state for ${data.poolAccountId} before acting on the updated balance.`,
            "after_sync",
            { options: { agent: true, chain: data.chain } },
          ),
        ]
      : []),
    createNextAction(
      "accounts",
      `Verify the updated balance for ${data.poolAccountId} after withdrawal.`,
      "after_withdraw",
      { options: { agent: true, chain: data.chain } },
    ),
  ];
  const humanNextActions = [
    ...(data.reconciliationRequired
      ? [
          createNextAction(
            "sync",
            `Reconcile local state for ${data.poolAccountId} before checking balances.`,
            "after_sync",
            { options: data.chain ? { chain: data.chain } : undefined },
          ),
        ]
      : []),
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
      reconciliationRequired: data.reconciliationRequired ?? false,
      localStateSynced: data.localStateSynced ?? true,
      warningCode: data.warningCode ?? null,
      rootMatchedAtProofTime: data.rootMatchedAtProofTime ?? true,
    };
    if (data.withdrawMode === "direct") {
      payload.feeBPS = null;
      payload.privacyCostManifest = buildDirectWithdrawalPrivacyCostManifest(data);
    } else {
      payload.feeBPS = data.feeBPS;
      payload.relayerHost = data.relayerHost ?? null;
      payload.quoteRefreshCount = data.quoteRefreshCount ?? 0;
      if (data.extraGas !== undefined) payload.extraGas = data.extraGas;
      if (data.extraGasFundAmount) {
        payload.extraGasFundAmount = data.extraGasFundAmount.toString();
      }
      if (data.nativeTokenPrice !== undefined && data.nativeTokenPrice !== null) {
        payload.nativeTokenPrice = data.nativeTokenPrice;
      }
    }
    if (data.anonymitySet) payload.anonymitySet = data.anonymitySet;
    if (data.warnings && data.warnings.length > 0) {
      payload.warnings = data.warnings;
    }
    printJsonSuccess(appendNextActions(payload, agentNextActions), false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const usd = (amount: bigint): string => {
    const val = formatUsdValue(amount, data.decimals, data.tokenPrice ?? null);
    return val === "-" ? "" : ` (${val})`;
  };
  if (!silent) {
    const feeBps = data.feeBPS ? BigInt(data.feeBPS) : null;
    const netAmount = feeBps !== null
      ? data.amount - (data.amount * feeBps) / 10000n
      : null;
    process.stderr.write(
      formatDenseOutcomeLine({
        outcome: data.withdrawMode === "direct" ? "success" : "withdraw",
        message:
          `${data.reconciliationRequired
            ? "Withdrawal confirmed onchain; local state needs reconciliation for"
            : data.withdrawMode === "direct"
              ? "Withdrew"
              : "Withdrew privately"} ` +
          `${formatAmount(data.amount, data.decimals, data.asset)} ` +
          `-> ${formatAddress(data.recipient)}${inlineSeparator()}${data.poolAccountId}${inlineSeparator()}Block ${data.blockNumber.toString()}`,
        url: data.explorerUrl,
      }),
    );
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Mode", value: data.withdrawMode },
        { label: "Pool Account", value: data.poolAccountId },
        { label: "Recipient", value: data.recipient },
        {
          label: "Amount",
          value: formatAmount(data.amount, data.decimals, data.asset),
        },
        { label: "Tx", value: formatTxHash(data.txHash) },
        ...(data.explorerUrl
          ? [{ label: "Explorer", value: data.explorerUrl }]
          : []),
        ...(data.withdrawMode === "relayed" && data.feeBPS
          ? [{
              label: "Relayer fee",
              value: `${formatBPS(data.feeBPS)} of withdrawal`,
            }]
          : []),
        ...(data.withdrawMode === "relayed" && data.relayerHost
          ? [{ label: "Relayer", value: data.relayerHost }]
          : []),
        ...(data.withdrawMode === "relayed" && data.quoteRefreshCount !== undefined
          ? [{ label: "Quote refreshes", value: String(data.quoteRefreshCount) }]
          : []),
        ...(netAmount !== null
          ? [{
              label: "You receive",
              value: `${formatAmount(netAmount, data.decimals, data.asset)}${usd(netAmount)}`,
            }]
          : []),
        ...(data.withdrawMode === "relayed" && data.extraGas
          ? [{
              label: "Gas token received",
              value: data.extraGasFundAmount
                ? formatNativeGasTokenAmount(
                    data.extraGasFundAmount,
                    data.nativeTokenPrice,
                  )
                : "ETH included with withdrawal",
            }]
          : []),
        ...(data.anonymitySet
          ? [{
              label: "Anonymity set",
              value: formatAnonymitySetValue(data.anonymitySet),
            }]
          : []),
        ...(data.remainingBalance === 0n
          ? [{ label: "Remaining", value: `${data.poolAccountId} fully withdrawn`, valueTone: "success" as const }]
          : [{
              label: `Remaining in ${data.poolAccountId}`,
              value: `${formatAmount(data.remainingBalance, data.decimals, data.asset)}${usd(data.remainingBalance)}`,
            }]),
      ]),
    );
    if (data.withdrawMode === "direct") {
      process.stderr.write(
        formatCallout(
          "danger",
          [
            "This was a direct public withdrawal, so your deposit and withdrawal addresses are linked onchain.",
            "Use the default relayed mode next time unless you fully accept that privacy loss.",
          ],
        ),
      );
    } else {
      process.stderr.write(
        formatCallout(
          data.reconciliationRequired ? "warning" : "success",
          data.reconciliationRequired
            ? [
                "Withdrawal confirmed onchain, but local state needs reconciliation before you rely on the saved balance.",
                `Run privacy-pools sync --chain ${data.chain} before continuing.`,
              ]
            : "The relayed withdrawal path completed. Re-check accounts if you want to confirm the remaining balance.",
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
  relayerHost?: string | null;
  quoteRefreshCount?: number;
  tokenPrice: number | null;
  nativeTokenPrice?: number | null;
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

  const minWithdrawFormatted = formatAmount(
    BigInt(data.minWithdrawAmount),
    data.decimals,
    data.asset,
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
  );
  const extraGasFundFormatted = data.extraGasFundAmount
    ? formatNativeGasTokenAmount(
        BigInt(data.extraGasFundAmount.eth),
        data.nativeTokenPrice,
      )
    : null;
  const extraGasTxCostFormatted = data.extraGasTxCost
    ? formatAmount(
        BigInt(data.extraGasTxCost.eth),
        18,
        "ETH",
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
        ...(!hasRecipient && {
          runnable: false,
          parameters: [{ name: "to", type: "address", required: true }],
        }),
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
      relayerHost: data.relayerHost ?? null,
      quoteRefreshCount: data.quoteRefreshCount ?? 0,
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
    const humanQuoteExpiry = data.quoteExpiresAt
      ? formatHumanQuoteExpiry(new Date(data.quoteExpiresAt).getTime())
      : null;
    const quoteRows = [
      { label: "Asset", value: data.asset },
      {
        label: "Withdraw amount",
        value: `${formatAmount(data.amount, data.decimals, data.asset)}${usd(data.amount)}`,
      },
      {
        label: "Total fee",
        value: `${formatAmount(feeAmount, data.decimals, data.asset)}${usd(feeAmount)} (${formatBPS(data.quoteFeeBPS)} of withdrawal)`,
      },
      {
        label: "Relayer fee",
        value: `${formatAmount((data.amount * BigInt(baseFeeBPS)) / 10000n, data.decimals, data.asset)}${usd((data.amount * BigInt(baseFeeBPS)) / 10000n)} (${formatBPS(baseFeeBPS)})`,
      },
      { label: "Blockchain relay cost", value: relayTxCostFormatted },
      ...(extraGasFundFormatted
        ? [{ label: "Gas token received", value: extraGasFundFormatted }]
        : []),
      ...(extraGasTxCostFormatted
        ? [{ label: "Gas token top-up cost", value: extraGasTxCostFormatted }]
        : []),
      {
        label: "You receive",
        value: `${formatAmount(netAmount, data.decimals, data.asset)}${usd(netAmount)}`,
      },
      { label: "Min withdraw", value: minWithdrawFormatted },
      ...(data.recipient
        ? [{ label: "Recipient", value: formatAddress(data.recipient) }]
        : []),
      ...(humanQuoteExpiry
        ? [{
            label: "Quote expires",
            value: humanQuoteExpiry.label,
          }]
        : []),
      ...(data.relayerHost
        ? [{ label: "Relayer", value: data.relayerHost }]
        : []),
      ...(data.quoteRefreshCount !== undefined
        ? [{ label: "Quote refreshes", value: String(data.quoteRefreshCount) }]
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
    if (!hasRecipient) {
      process.stderr.write(
        formatCallout(
          "read-only",
          "Add --to <address> for an accurate fee quote and a runnable next step.",
        ),
      );
    }
  }
  renderNextSteps(ctx, humanNextActions);
}
