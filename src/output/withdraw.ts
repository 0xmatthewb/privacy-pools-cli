/**
 * Output renderer for the `withdraw` command.
 *
 * Handles dry-run, success, and quote output for both direct
 * and relayed withdrawal modes.
 * Unsigned output, spinners, proof generation, relayer interactions, and
 * prompts remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import type { DryRunMode } from "../utils/dry-run-mode.js";
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
import {
  mergeStructuredWarnings,
  warningFromCode,
} from "./warnings.js";
import type { PrivacyNonRoundAmountWarning } from "../utils/amount-privacy.js";

export interface WithdrawAnonymitySet {
  eligible: number;
  total: number;
  percentage: number;
}

export type WithdrawUiWarning = {
  code: string;
  category: string;
  message: string;
} & Partial<Pick<PrivacyNonRoundAmountWarning, "suggestedRoundAmount" | "escape">>;

export interface RelayedWithdrawalRemainderGuidance {
  summary: string;
  choices: string[];
}

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
  remainingBelowMinGuidance?: RelayedWithdrawalRemainderGuidance | null;
  nowMs?: number;
  anonymitySet?: WithdrawAnonymitySet;
}

export interface DirectWithdrawalReviewData {
  poolAccountId: string;
  amount: bigint;
  asset: string;
  chain: string;
  decimals: number;
  recipient: string;
  signerAddress?: string | null;
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

export function formatAnonymitySetValue(anonymitySet: WithdrawAnonymitySet): string {
  return `${anonymitySet.eligible} of ${anonymitySet.total} deposits (${anonymitySet.percentage.toFixed(1)}%; larger is more private)`;
}

function formatAnonymitySetNote(
  anonymitySet?: WithdrawAnonymitySet,
): string | null {
  if (!anonymitySet) return null;
  return `Estimated anonymity set at this amount: ${formatAnonymitySetValue(anonymitySet)}.`;
}

export function formatAnonymitySetCallout(
  anonymitySet?: WithdrawAnonymitySet,
): string {
  const note = formatAnonymitySetNote(anonymitySet);
  return note ? formatCallout("privacy", note) : "";
}

function formatRelayedWithdrawalRemainderHint(
  guidance: RelayedWithdrawalRemainderGuidance,
): string {
  return formatCallout(
    "warning",
    [
      guidance.summary,
      "You can: (1) withdraw less, (2) withdraw the full balance with --all, or (3) plan a public recovery later via ragequit (compromises privacy for the remainder).",
      ...guidance.choices.map((choice) => `- ${choice}`),
    ].join("\n"),
  );
}

function getFriendlyTestnetMinWithdrawFloor(decimals: number): bigint {
  return decimals >= 6 ? 10n ** BigInt(decimals - 6) : 1n;
}

function hasWarning(
  warnings: WithdrawUiWarning[] | undefined,
  code: string,
): boolean {
  return (warnings ?? []).some((warning) => warning.code === code);
}

function formatMinWithdrawDisplay(data: {
  minWithdrawAmount: string;
  decimals: number;
  asset: string;
  isTestnet?: boolean;
  warnings?: WithdrawUiWarning[];
}): string {
  const minWithdrawAmount = BigInt(data.minWithdrawAmount);
  if (
    data.isTestnet &&
    hasWarning(data.warnings, "TESTNET_MIN_WITHDRAW_AMOUNT_UNUSUALLY_LOW") &&
    minWithdrawAmount < getFriendlyTestnetMinWithdrawFloor(data.decimals)
  ) {
    return `< ${formatAmount(getFriendlyTestnetMinWithdrawFloor(data.decimals), data.decimals, data.asset)}`;
  }
  return formatAmount(minWithdrawAmount, data.decimals, data.asset);
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
        ? `expired (${localTimestamp}; if this happens repeatedly, your system clock may be inaccurate)`
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
    ...(data.remainingBelowMinGuidance
      ? [
          data.remainingBelowMinGuidance.summary,
          ...data.remainingBelowMinGuidance.choices.map(
            (choice) => `• ${choice}`,
          ),
        ]
      : []),
    ...(secondsLeft <= 30
      ? [
          "This quote is close to expiry. The CLI will refresh before proof generation when it can; if the fee changes, you will need to re-run the withdrawal.",
        ]
      : []),
    ...(formatAnonymitySetNote(data.anonymitySet)
      ? [formatAnonymitySetNote(data.anonymitySet)!]
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
        label: "Remainder",
        value:
          data.remainingBalance === 0n
            ? `${data.poolAccountId} fully withdrawn`
            : `${formatAmount(data.remainingBalance, data.decimals, data.asset)}${usd(data.remainingBalance)}`,
        valueTone:
          data.remainingBalance > 0n && data.remainingBelowMinGuidance
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
    secondaryCallout: secondaryLines.length > 0
      ? {
          kind:
            data.remainingBelowMinGuidance || secondsLeft <= 30
              ? "warning"
              : "privacy",
          lines: secondaryLines,
        }
      : null,
    footerTitle: "Totals",
    footerRows: [
      {
        label: "Total withdrawn",
        value: `${formatAmount(data.amount, data.decimals, data.asset)}${usd(data.amount)}`,
        valueTone: "accent",
      },
      {
        label: "Total received",
        value: `${formatAmount(netAmount, data.decimals, data.asset)}${usd(netAmount)}`,
        valueTone: "success",
      },
    ],
    helpCommand: "privacy-pools guide workflow",
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
      ...(data.signerAddress
        ? [{ label: "Signer", value: data.signerAddress }]
        : []),
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
    footerTitle: "Totals",
    footerRows: [
      {
        label: "Total withdrawn",
        value:
          `${formatAmount(data.amount, data.decimals, data.asset)}` +
          (amountUsd === "-" ? "" : ` (${amountUsd})`),
        valueTone: "accent",
      },
      {
        label: "Net received",
        value:
          `${formatAmount(data.amount, data.decimals, data.asset)}` +
          (amountUsd === "-" ? "" : ` (${amountUsd})`),
        valueTone: "success",
      },
      {
        label: "Privacy outcome",
        value: "no privacy gained",
        valueTone: "danger",
      },
    ],
    helpCommand: "privacy-pools guide workflow",
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
  dryRunMode?: DryRunMode | null;
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
  anonymitySet?: WithdrawAnonymitySet;
  remainingBelowMinGuidance?: RelayedWithdrawalRemainderGuidance | null;
  warnings?: WithdrawUiWarning[];
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
    actionOptions.confirmDirectWithdraw = true;
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
    humanActionOptions.confirmDirectWithdraw = true;
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
      dryRunMode: data.dryRunMode ?? "rpc",
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
    process.stderr.write(
      formatReviewSurface({
        title: "Withdrawal dry-run",
        summaryRows: [
          { label: "Mode", value: data.withdrawMode },
          {
            label: "Amount",
            value: formatAmount(data.amount, data.decimals, data.asset),
          },
          { label: "Recipient", value: formatAddress(data.recipient) },
          { label: "Pool Account", value: data.poolAccountId },
          ...(data.withdrawMode === "relayed" && data.feeBPS
            ? [{ label: "Relayer fee", value: formatBPS(data.feeBPS), valueTone: "warning" as const }]
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
          ...(data.withdrawMode === "relayed" && data.remainingBelowMinGuidance
            ? [{
                label: "Remainder",
                value: formatAmount(
                  data.selectedCommitmentValue - data.amount,
                  data.decimals,
                  data.asset,
                ),
                valueTone: "warning" as const,
              }]
            : []),
          ...(data.withdrawMode === "relayed" && data.extraGas
            ? [{
                label: "Gas token received",
                value: "enabled (receive ETH for gas)",
                valueTone: "accent" as const,
              }]
            : []),
          {
            label: "Pool Account balance",
            value: formatAmount(data.selectedCommitmentValue, data.decimals, data.asset),
          },
          {
            label: "Root check",
            value: data.rootMatchedAtProofTime === false
              ? "stale at proof time"
              : "matched latest root",
            valueTone: data.rootMatchedAtProofTime === false ? "warning" : "success",
          },
          ...(data.anonymitySet
            ? [{
                label: "Anonymity set",
                value: formatAnonymitySetValue(data.anonymitySet),
              }]
            : []),
        ],
        primaryCallout: {
          kind: data.withdrawMode === "direct" ? "warning" : "read-only",
          lines: data.withdrawMode === "direct"
            ? "Direct withdrawals publicly link your deposit and withdrawal addresses onchain. Use relayed mode for private withdrawals."
            : "No transaction was submitted and no local account state was changed.",
        },
      }),
    );
    if (data.withdrawMode === "relayed" && data.remainingBelowMinGuidance) {
      process.stderr.write(
        formatRelayedWithdrawalRemainderHint(data.remainingBelowMinGuidance),
      );
    }
  }
  renderNextSteps(ctx, humanNextActions);
}

// ── Success ──────────────────────────────────────────────────────────────────

export interface WithdrawSuccessData {
  status?: "submitted" | "confirmed";
  submissionId?: string;
  withdrawMode: "direct" | "relayed";
  txHash: string;
  blockNumber: bigint | null;
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
  anonymitySet?: WithdrawAnonymitySet;
  rootMatchedAtProofTime?: boolean;
  reconciliationRequired?: boolean;
  localStateSynced?: boolean;
  warningCode?: string | null;
  warnings?: WithdrawUiWarning[];
}

/**
 * Render withdraw success output (both direct and relayed).
 */
export function renderWithdrawSuccess(ctx: OutputContext, data: WithdrawSuccessData): void {
  guardCsvUnsupported(ctx, "withdraw");
  const isSubmitted = data.status === "submitted";

  const agentNextActions = [
    ...(isSubmitted && data.submissionId
      ? [
          createNextAction(
            "tx-status",
            "Poll the submitted withdrawal until the onchain transaction confirms.",
            "after_submit",
            { args: [data.submissionId], options: { agent: true } },
          ),
        ]
      : []),
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
    ...(!isSubmitted
      ? [
          createNextAction(
            "accounts",
            `Verify the updated balance for ${data.poolAccountId} after withdrawal.`,
            "after_withdraw",
            { options: { agent: true, chain: data.chain } },
          ),
        ]
      : []),
  ];
  const humanNextActions = [
    ...(isSubmitted && data.submissionId
      ? [
          createNextAction(
            "tx-status",
            "Check whether the submitted withdrawal has confirmed yet.",
            "after_submit",
            { args: [data.submissionId] },
          ),
        ]
      : []),
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
    ...(!isSubmitted
      ? [
          createNextAction(
            "accounts",
            `Verify the updated balance for ${data.poolAccountId}.`,
            "after_withdraw",
            { options: data.chain ? { chain: data.chain } : undefined },
          ),
        ]
      : []),
  ];

  if (ctx.mode.isJson) {
    const warnings = mergeStructuredWarnings(
      data.warnings,
      warningFromCode(data.warningCode, {
        chain: data.chain,
        subject: "withdrawal balance",
      }),
    );
    const payload: Record<string, unknown> = {
      operation: "withdraw",
      status: data.status ?? "confirmed",
      pending: isSubmitted,
      submissionId: data.submissionId ?? null,
      mode: data.withdrawMode,
      txHash: data.txHash,
      blockNumber: data.blockNumber?.toString() ?? null,
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
    if (warnings) {
      payload.warnings = warnings;
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
          `${isSubmitted
            ? "Withdrawal submitted for"
            : data.reconciliationRequired
              ? "Withdrawal confirmed onchain; local state needs reconciliation for"
              : data.withdrawMode === "direct"
                ? "Withdrew"
                : "Withdrew privately"} ` +
          `${formatAmount(data.amount, data.decimals, data.asset)} ` +
          `-> ${formatAddress(data.recipient)}${inlineSeparator()}${data.poolAccountId}` +
          (data.blockNumber !== null
            ? `${inlineSeparator()}Block ${data.blockNumber.toString()}`
            : ""),
        url: data.explorerUrl,
      }),
    );
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Mode", value: data.withdrawMode },
        ...(data.withdrawMode === "direct"
          ? [{ label: "Privacy outcome", value: "no privacy gained" }]
          : []),
        { label: "Pool Account", value: data.poolAccountId },
        { label: "Recipient", value: data.recipient },
        {
          label: "Amount",
          value: formatAmount(data.amount, data.decimals, data.asset),
        },
        ...(data.submissionId
          ? [{ label: "Submission", value: data.submissionId }]
          : []),
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
          isSubmitted
            ? "warning"
            : data.reconciliationRequired ? "warning" : "success",
          isSubmitted
            ? [
                "The withdrawal transaction was submitted and may still be pending onchain.",
                "Use tx-status with the returned submission id to poll for confirmation without resubmitting.",
              ]
            : data.reconciliationRequired
            ? [
                "Withdrawal confirmed onchain, but local state needs reconciliation before you rely on the saved balance.",
                `Run privacy-pools sync --chain ${data.chain} before continuing.`,
              ]
            : "The relayed withdrawal path completed. Re-check accounts if you want to confirm the remaining balance.",
        ),
      );
      if (data.anonymitySet) {
        process.stderr.write(formatAnonymitySetCallout(data.anonymitySet));
      }
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
  isTestnet: boolean;
  anonymitySet?: WithdrawAnonymitySet;
  warnings?: WithdrawUiWarning[];
}

/**
 * Render withdraw quote output.
 */
export function renderWithdrawQuote(ctx: OutputContext, data: WithdrawQuoteData): void {
  guardCsvUnsupported(ctx, "withdraw quote");

  const minWithdrawFormatted = formatMinWithdrawDisplay(data);

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
  const quoteExpiryMs = data.quoteExpiresAt
    ? new Date(data.quoteExpiresAt).getTime()
    : null;
  const quoteExpired =
    quoteExpiryMs !== null &&
    Number.isFinite(quoteExpiryMs) &&
    quoteExpiryMs <= Date.now();
  const quoteExpiryWarning: WithdrawUiWarning | null = quoteExpired
    ? {
        code: "WITHDRAW_QUOTE_EXPIRED",
        category: "relayer",
        message: "This relayer quote has expired. Request a fresh quote before submitting the withdrawal. If this happens repeatedly, your system clock may be inaccurate.",
      }
    : null;
  const warnings = [
    ...(data.warnings ?? []),
    ...(quoteExpiryWarning ? [quoteExpiryWarning] : []),
  ];

  // When the recipient is missing, the command is a template — not directly runnable.
  // Agents get the full action (with `to: null`) so they know to supply --to.
  // Humans never see non-runnable actions (renderNextSteps filters them out).
  const hasRecipient = data.recipient !== null && data.recipient !== undefined;
  const followupCommand = quoteExpired ? "withdraw quote" : "withdraw";
  const followupReason = quoteExpired
    ? "Request a fresh relayer quote before submitting the withdrawal."
    : hasRecipient
      ? "Submit the withdrawal promptly if the quoted fee is acceptable."
      : "Supply a --to address and submit the withdrawal.";
  const agentNextActions = [
    createNextAction(
      followupCommand,
      followupReason,
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
  const humanNextActions = (quoteExpired || netAmount > 0n) && hasRecipient
    ? [
        createNextAction(
          followupCommand,
          quoteExpired
            ? "Request a fresh relayer quote before submitting the withdrawal."
            : "Submit the withdrawal promptly if the quoted fee is acceptable.",
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
      isTestnet: data.isTestnet,
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
    if (data.anonymitySet) {
      payload.anonymitySet = data.anonymitySet;
    }
    if (warnings.length > 0) {
      payload.warnings = warnings;
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
    if (warnings.length > 0) {
      process.stderr.write(
        formatCallout(
          "warning",
          warnings.map((warning) => warning.message),
        ),
      );
    }
    if (data.anonymitySet) {
      process.stderr.write(formatAnonymitySetCallout(data.anonymitySet));
    }
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
