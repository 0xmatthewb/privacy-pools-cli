/**
 * Output renderer for the `deposit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, prompts, and balance checks remain in the
 * command handler.
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
  info,
  warn,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import {
  formatAmount,
  formatBPS,
  formatDenseOutcomeLine,
  formatTxHash,
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
import {
  mergeStructuredWarnings,
  type TransactionJsonWarning,
  warningFromCode,
} from "./warnings.js";
import { FIRST_DEPOSIT_WELCOME } from "./copy.js";
import type { DeprecationWarningPayload } from "./deprecation.js";

export interface DepositReviewData {
  amount: bigint;
  feeAmount: bigint;
  estimatedCommitted: bigint;
  vettingFeeBPS: bigint;
  asset: string;
  chain: string;
  decimals: number;
  depositorAddress?: string;
  tokenPrice?: number | null;
  isErc20?: boolean;
  estimatedGasCost?: bigint | null;
  gasSymbol?: string;
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
  const secondaryLines = [
    ...(data.isErc20
      ? ["This will require 2 transactions: token approval + deposit."]
      : []),
    ...(data.estimatedGasCost !== undefined && data.estimatedGasCost !== null
      ? ["Gas estimate is best effort and may change before submission."]
      : []),
  ];
  return formatReviewSurface({
    title: "Deposit review",
    summaryRows: [
      {
        label: "Amount",
        value:
          `${formatAmount(data.amount, data.decimals, data.asset)}` +
          depositUsdSuffix(data.amount, data.decimals, data.tokenPrice),
      },
      ...(data.depositorAddress
        ? [{ label: "Depositor", value: data.depositorAddress }]
        : []),
      { label: "Chain", value: data.chain },
      {
        label: `Vetting fee (${formatBPS(data.vettingFeeBPS)})`,
        value:
          `${formatAmount(data.feeAmount, data.decimals, data.asset)}` +
          depositUsdSuffix(data.feeAmount, data.decimals, data.tokenPrice),
        valueTone: "warning",
      },
      {
        label: "Net deposited",
        value:
          `${formatAmount(data.estimatedCommitted, data.decimals, data.asset)}` +
          depositUsdSuffix(data.estimatedCommitted, data.decimals, data.tokenPrice),
        valueTone: "success",
      },
      ...(data.estimatedGasCost !== undefined && data.estimatedGasCost !== null
        ? [
            {
              label: "Est. gas",
              value: formatAmount(
                data.estimatedGasCost,
                18,
                data.gasSymbol ?? "ETH",
              ),
              valueTone: "muted" as const,
            },
          ]
        : []),
    ],
    primaryCallout: {
      kind: "privacy",
      lines: [
        "Deposits are always public onchain.",
        "Association Set Provider (ASP) approval unlocks private withdrawal via relayer.",
        DEPOSIT_APPROVAL_TIMELINE_COPY,
      ],
    },
    secondaryCallout: secondaryLines.length > 0
      ? {
          kind: "read-only",
          lines: secondaryLines,
        }
      : null,
    footerTitle: "Totals",
    footerRows: [
      {
        label: "Total submitted",
        value:
          `${formatAmount(data.amount, data.decimals, data.asset)}` +
          depositUsdSuffix(data.amount, data.decimals, data.tokenPrice),
        valueTone: "accent",
      },
      {
        label: "Net committed",
        value:
          `${formatAmount(data.estimatedCommitted, data.decimals, data.asset)}` +
          depositUsdSuffix(data.estimatedCommitted, data.decimals, data.tokenPrice),
        valueTone: "success",
      },
    ],
    helpCommand: "privacy-pools guide workflow",
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
  vettingFeeBPS: bigint;
  feeAmount: bigint;
  estimatedCommitted: bigint;
  feesApply: boolean;
  poolAccountNumber: number;
  poolAccountId: string;
  precommitment: bigint;
  balanceSufficient: boolean | "unknown";
  dryRunMode?: DryRunMode | null;
  deprecationWarning?: DeprecationWarningPayload;
  warnings?: TransactionJsonWarning[];
}

export interface DepositSuccessData {
  status: "submitted" | "confirmed";
  submissionId?: string;
  workflowId?: string | null;
  txHash: string;
  /** ERC20 approve tx hash from auto-run approval. Null for native ETH or sufficient existing allowance. */
  approvalTxHash?: string | null;
  amount: bigint;
  committedValue: bigint | undefined;
  vettingFeeBPS?: bigint;
  vettingFeeAmount?: bigint;
  estimatedCommitted?: bigint;
  feesApply?: boolean;
  asset: string;
  chain: string;
  decimals: number;
  poolAccountNumber: number;
  poolAccountId: string;
  poolAddress: string;
  scope: bigint;
  label: bigint | undefined;
  blockNumber: bigint | null;
  explorerUrl: string | null;
  reconciliationRequired?: boolean;
  localStateSynced?: boolean;
  warningCode?: string | null;
  warnings?: TransactionJsonWarning[];
  deprecationWarning?: DeprecationWarningPayload;
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
        dryRunMode: data.dryRunMode ?? "rpc",
        operation: "deposit",
        chain: data.chain,
        asset: data.asset,
        amount: data.amount.toString(),
        vettingFeeBPS: data.vettingFeeBPS.toString(),
        vettingFeeAmount: data.feeAmount.toString(),
        estimatedCommitted: data.estimatedCommitted.toString(),
        feesApply: data.feesApply,
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        precommitment: data.precommitment.toString(),
        balanceSufficient: data.balanceSufficient,
        ...(data.deprecationWarning ? { deprecationWarning: data.deprecationWarning } : {}),
        warnings: [
          {
            code: "PREVIEW_VALIDATION_APPROXIMATE",
            category: "preview",
            message: "Dry-run validation is approximate until the transaction is signed and submitted.",
          },
          ...(data.warnings ?? []),
        ],
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success(DRY_RUN_FOOTER_COPY, silent);
  if (!silent) {
    const balanceLabel =
      data.balanceSufficient === "unknown"
        ? "unknown (no signer key provided)"
        : data.balanceSufficient
          ? "yes"
          : "no";
    process.stderr.write(
      formatReviewSurface({
        title: "Deposit dry-run",
        summaryRows: [
          { label: "Chain", value: data.chain },
          { label: "Asset", value: data.asset },
          { label: "Pool Account", value: data.poolAccountId },
          {
            label: "Amount",
            value: formatAmount(
              data.amount,
              data.decimals,
              data.asset,
            ),
          },
          {
            label: "Vetting fee",
            value: `${formatAmount(data.feeAmount, data.decimals, data.asset)} (${formatBPS(data.vettingFeeBPS)})`,
            valueTone: "warning",
          },
          {
            label: "Expected net deposited",
            value: formatAmount(
              data.estimatedCommitted,
              data.decimals,
              data.asset,
            ),
            valueTone: "success",
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
        ],
        primaryCallout: {
          kind: "read-only",
          lines: "No transaction was submitted and no local Pool Account was saved.",
        },
      }),
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
  const isSubmitted = data.status === "submitted";
  const reconciliationAction = data.reconciliationRequired
    ? [
        createNextAction(
          "sync",
          `Reconcile local state for ${data.poolAccountId} before acting on the updated Pool Account.`,
          "after_sync",
          { options: { agent: true, chain: data.chain } },
        ),
      ]
    : [];
  const agentNextActions = [
    ...(isSubmitted && data.submissionId
      ? [
          createNextAction(
            "tx-status",
            "Poll the submitted deposit until the onchain transaction confirms.",
            "after_submit",
            { args: [data.submissionId], options: { agent: true } },
          ),
        ]
      : []),
    ...reconciliationAction,
    ...(data.workflowId
      ? [
          createNextAction(
            "flow status",
            isSubmitted
              ? "Track the saved deposit-review workflow after the transaction confirms."
              : "Track ASP review through the saved deposit-review workflow.",
            isSubmitted ? "after_submit" : "after_deposit",
            { args: [data.workflowId], options: { agent: true } },
          ),
        ]
      : []),
    ...(!isSubmitted
      ? [
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
        options: { agent: true, chain: data.chain, poolAccount: data.poolAccountId },
      },
    ),
        ]
      : []),
  ];
  const humanNextActions = [
    ...(isSubmitted && data.submissionId
      ? [
          createNextAction(
            "tx-status",
            "Check whether the submitted deposit has confirmed yet.",
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
            { options: { chain: data.chain } },
          ),
        ]
      : []),
    ...(data.workflowId
      ? [
          createNextAction(
            "flow status",
            isSubmitted
              ? "Track the saved deposit-review workflow after the transaction confirms."
              : "Track ASP review through the saved deposit-review workflow.",
            isSubmitted ? "after_submit" : "after_deposit",
            { args: [data.workflowId] },
          ),
        ]
      : []),
    ...(!isSubmitted
      ? [
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
      `If declined or you prefer not to wait, ragequit is available for public recovery. POA portal: ${POA_PORTAL_URL}`,
      "after_deposit",
      {
        args: [data.asset],
        options: {
          chain: data.chain,
          poolAccount: data.poolAccountId,
        },
      },
    ),
        ]
      : []),
  ];

  if (ctx.mode.isJson) {
    const warnings = mergeStructuredWarnings(
      data.warnings,
      warningFromCode(data.warningCode, {
        chain: data.chain,
        subject: "deposit state",
      }),
    );
    printJsonSuccess(
      appendNextActions({
        operation: "deposit",
        status: data.status,
        pending: isSubmitted,
        submissionId: data.submissionId ?? null,
        workflowId: data.workflowId ?? null,
        txHash: data.txHash,
        approvalTxHash: data.approvalTxHash ?? null,
        amount: data.amount.toString(),
        committedValue: data.committedValue?.toString() ?? null,
        vettingFeeBPS: data.vettingFeeBPS?.toString() ?? null,
        vettingFeeAmount: data.vettingFeeAmount?.toString() ?? null,
        estimatedCommitted:
          data.estimatedCommitted?.toString() ??
          data.committedValue?.toString() ??
          null,
        feesApply: data.feesApply ?? false,
        asset: data.asset,
        chain: data.chain,
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        poolAddress: data.poolAddress,
        scope: data.scope.toString(),
        label: data.label?.toString() ?? null,
        blockNumber: data.blockNumber?.toString() ?? null,
        explorerUrl: data.explorerUrl,
        reconciliationRequired: data.reconciliationRequired ?? false,
        localStateSynced: data.localStateSynced ?? true,
        warningCode: data.warningCode ?? null,
        ...(data.deprecationWarning ? { deprecationWarning: data.deprecationWarning } : {}),
        ...(warnings ? { warnings } : {}),
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  if (!silent) {
    process.stderr.write(
      formatDenseOutcomeLine({
        outcome: "deposit",
        message:
          `${isSubmitted
            ? "Deposit submitted for"
            : data.reconciliationRequired
              ? "Deposit confirmed onchain; local state needs reconciliation for"
              : "Deposited"} ` +
          `${formatAmount(data.amount, data.decimals, data.asset)} ` +
          `-> ${data.chain} ${data.asset} pool${inlineSeparator()}${data.poolAccountId}` +
          (data.blockNumber !== null
            ? `${inlineSeparator()}Block ${data.blockNumber.toString()}`
            : ""),
        url: data.explorerUrl,
      }),
    );
    if (data.poolAccountNumber === 1) {
      process.stderr.write(formatCallout("success", [FIRST_DEPOSIT_WELCOME]));
    }
    const summaryRows = [
      { label: "Chain", value: data.chain },
      { label: "Pool Account", value: data.poolAccountId },
      {
        label: "Amount",
        value: formatAmount(data.amount, data.decimals, data.asset),
      },
      ...(data.committedValue !== undefined
        ? [{
            label: "Net deposited",
            value: `${formatAmount(data.committedValue, data.decimals, data.asset)} (after ASP vetting fee)`,
          }]
        : []),
      ...(data.workflowId
        ? [{ label: "Workflow", value: data.workflowId }]
        : []),
      ...(data.submissionId
        ? [{ label: "Submission", value: data.submissionId }]
        : []),
      { label: "Tx", value: formatTxHash(data.txHash) },
      ...(data.approvalTxHash
        ? [{ label: "Approve tx", value: formatTxHash(data.approvalTxHash) }]
        : []),
      ...(data.explorerUrl
        ? [{ label: "Explorer", value: data.explorerUrl }]
        : []),
    ];
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(formatKeyValueRows(summaryRows));
    process.stderr.write(
      formatCallout(
        "warning",
        data.reconciliationRequired
          ? [
              "Deposit confirmed onchain, but local state needs reconciliation before you rely on the saved Pool Account state.",
              `Run privacy-pools sync --chain ${data.chain} before continuing.`,
            ]
          : isSubmitted
            ? [
                "The deposit transaction was submitted and may still be pending onchain.",
                "Use tx-status with the returned submission id to poll for confirmation without resubmitting.",
              ]
          : [
              "The ASP will validate that this deposit is coming from a good actor (not a flagged account). Private withdrawal unlocks after approval.",
              `${DEPOSIT_APPROVAL_TIMELINE_COPY}`,
            ],
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
