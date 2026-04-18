/**
 * Output renderer for the `ragequit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, proof generation, and prompts remain in the
 * command handler.
 */

import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  DRY_RUN_FOOTER_COPY,
  renderNextSteps,
  printJsonSuccess,
  success,
  info,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import {
  formatAddress,
  formatAmount,
  formatDenseOutcomeLine,
  formatTxHash,
  formatUsdValue,
} from "../utils/format.js";
import { inlineSeparator } from "../utils/terminal.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";
import { formatReviewSurface } from "./review.js";

export interface RagequitReviewData {
  poolAccountId: string;
  amount: bigint;
  asset: string;
  chain: string;
  decimals: number;
  destinationAddress: string | null;
  advisory?: string | null;
  advisoryKind?: "warning" | "read-only";
  tokenPrice?: number | null;
}

const RAGEQUIT_PRIVACY_WARNING_COPY =
  "Ragequit publicly recovers all funds to your deposit address. You will not gain any privacy.";

export function buildRagequitPrivacyCostManifest(data: {
  poolAccountId: string;
  amount: bigint;
  asset: string;
  chain: string;
  destinationAddress: string | null;
}): Record<string, unknown> {
  return {
    action: "ragequit",
    framing: "public_self_custody_recovery",
    poolAccountId: data.poolAccountId,
    amount: data.amount.toString(),
    asset: data.asset,
    chain: data.chain,
    destinationAddress: data.destinationAddress,
    privacyCost: "funds return publicly to the original depositing address",
    privacyPreserved: false,
    recommendation: "Prefer a relayed private withdrawal when the Pool Account is approved and above the relayer minimum.",
  };
}

export function formatRagequitReview(data: RagequitReviewData): string {
  const amountUsd = formatUsdValue(
    data.amount,
    data.decimals,
    data.tokenPrice ?? null,
  );
  return formatReviewSurface({
    title: "Ragequit review",
    summaryRows: [
      { label: "Pool Account", value: data.poolAccountId },
      {
        label: "Amount",
        value:
          formatAmount(
            data.amount,
            data.decimals,
            data.asset,
          ) + (amountUsd === "-" ? "" : ` (${amountUsd})`),
      },
      { label: "Chain", value: data.chain },
      {
        label: "Privacy outcome",
        value: "no privacy (public recovery)",
        valueTone: "warning",
      },
      {
        label: "Destination",
        value: data.destinationAddress
          ? data.destinationAddress
          : "original deposit address",
      },
    ],
    primaryCallout: {
      kind: "danger",
      lines: [
        RAGEQUIT_PRIVACY_WARNING_COPY,
      ],
    },
    secondaryCallout: data.advisory
      ? {
          kind: data.advisoryKind ?? "warning",
          lines: data.advisory,
        }
      : null,
  });
}

export interface RagequitDryRunData {
  chain: string;
  asset: string;
  amount: bigint;
  decimals: number;
  destinationAddress: string | null;
  poolAccountNumber: number;
  poolAccountId: string;
  selectedCommitmentLabel: bigint;
  selectedCommitmentValue: bigint;
  proofPublicSignals: number;
  advisory?: string | null;
  approvedAlternative?: boolean;
  tokenPrice?: number | null;
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
  destinationAddress: string | null;
  advisory?: string | null;
  reconciliationRequired?: boolean;
  localStateSynced?: boolean;
  warningCode?: string | null;
  tokenPrice?: number | null;
}

/**
 * Render ragequit dry-run output.
 *
 * Prints a human-readable summary of what would happen without submitting.
 */
export function renderRagequitDryRun(ctx: OutputContext, data: RagequitDryRunData): void {
  guardCsvUnsupported(ctx, "ragequit --dry-run");

  const agentNextActions = [
    createNextAction(
      "ragequit",
      "Submit the ragequit for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [data.asset],
        options: {
          agent: true,
          chain: data.chain,
          poolAccount: data.poolAccountId,
          confirmRagequit: true,
        },
      },
    ),
  ];
  const humanNextActions = [
    createNextAction(
      "ragequit",
      "Submit the ragequit for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [data.asset],
        options: {
          chain: data.chain,
          poolAccount: data.poolAccountId,
          confirmRagequit: true,
        },
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
        dryRun: true,
        operation: "ragequit",
        chain: data.chain,
        asset: data.asset,
        amount: data.amount.toString(),
        destinationAddress: data.destinationAddress,
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        selectedCommitmentLabel: data.selectedCommitmentLabel.toString(),
        selectedCommitmentValue: data.selectedCommitmentValue.toString(),
        proofPublicSignals: data.proofPublicSignals,
        remainingBalance: "0",
        privacyCostManifest: buildRagequitPrivacyCostManifest(data),
        warnings: [
          {
            code: "PREVIEW_VALIDATION_APPROXIMATE",
            category: "preview",
            message: "Dry-run validation is approximate until the transaction is signed and submitted.",
          },
        ],
        ...(data.advisory ? { advisory: data.advisory } : {}),
        approvedAlternative: data.approvedAlternative ?? false,
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success(DRY_RUN_FOOTER_COPY, silent);
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: data.chain },
        { label: "Asset", value: data.asset },
        { label: "Pool Account", value: data.poolAccountId },
        {
          label: "Amount",
          value:
            formatAmount(
              data.amount,
              data.decimals,
              data.asset,
            ) +
            (() => {
              const amountUsd = formatUsdValue(
                data.amount,
                data.decimals,
                data.tokenPrice ?? null,
              );
              return amountUsd === "-" ? "" : ` (${amountUsd})`;
            })(),
        },
        ...(data.destinationAddress
          ? [{
              label: "Destination",
              value: data.destinationAddress,
            }]
          : []),
      ]),
    );
    process.stderr.write(
      formatCallout(
        "recovery",
        RAGEQUIT_PRIVACY_WARNING_COPY,
      ),
    );
    process.stderr.write(
      formatCallout(
        "danger",
        "Once submitted onchain, this ragequit cannot be reversed into a private withdrawal for the same Pool Account.",
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}

/**
 * Render ragequit success output.
 */
export function renderRagequitSuccess(ctx: OutputContext, data: RagequitSuccessData): void {
  guardCsvUnsupported(ctx, "ragequit");

  const agentNextActions = [
    ...(data.reconciliationRequired
      ? [
          createNextAction(
            "sync",
            `Reconcile local state for ${data.poolAccountId} before acting on the updated account status.`,
            "after_sync",
            { options: { agent: true, chain: data.chain } },
          ),
        ]
      : []),
    createNextAction(
      "accounts",
      `Verify the account status for ${data.poolAccountId} after ragequit.`,
      "after_ragequit",
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
      `Verify the account status for ${data.poolAccountId}.`,
      "after_ragequit",
      { options: data.chain ? { chain: data.chain } : undefined },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
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
        destinationAddress: data.destinationAddress,
        remainingBalance: "0",
        reconciliationRequired: data.reconciliationRequired ?? false,
        localStateSynced: data.localStateSynced ?? true,
        warningCode: data.warningCode ?? null,
        privacyCostManifest: buildRagequitPrivacyCostManifest(data),
        ...(data.advisory ? { advisory: data.advisory } : {}),
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const destinationLabel = data.destinationAddress
    ? formatAddress(data.destinationAddress)
    : "deposit address";
  if (!silent) {
    process.stderr.write(
      formatDenseOutcomeLine({
        outcome: "recovery",
        message:
          `${data.reconciliationRequired ? "Ragequit confirmed onchain; local state needs reconciliation for" : "Ragequit"} ${formatAmount(data.amount, data.decimals, data.asset)} ` +
          `-> ${destinationLabel}${inlineSeparator()}${data.poolAccountId}${inlineSeparator()}Block ${data.blockNumber.toString()}`,
        url: data.explorerUrl,
      }),
    );
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: data.chain },
        { label: "Pool Account", value: data.poolAccountId },
        {
          label: "Amount",
          value:
            formatAmount(
              data.amount,
              data.decimals,
              data.asset,
            ) +
            (() => {
              const amountUsd = formatUsdValue(
                data.amount,
                data.decimals,
                data.tokenPrice ?? null,
              );
              return amountUsd === "-" ? "" : ` (${amountUsd})`;
            })(),
        },
        { label: "Tx", value: formatTxHash(data.txHash) },
        ...(data.explorerUrl
          ? [{ label: "Explorer", value: data.explorerUrl }]
          : []),
        ...(data.destinationAddress
          ? [{
              label: "Destination",
              value: data.destinationAddress,
            }]
          : []),
      ]),
    );
    process.stderr.write(
      formatCallout(
        data.reconciliationRequired ? "warning" : "recovery",
        data.reconciliationRequired
          ? [
              "Ragequit confirmed onchain, but local state needs reconciliation before you rely on the saved account status.",
              `Run privacy-pools sync --chain ${data.chain} before continuing.`,
            ]
          : RAGEQUIT_PRIVACY_WARNING_COPY,
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
