import { POA_PORTAL_URL } from "../config/chains.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "../utils/approval-timing.js";
import { formatUnits } from "viem";
import {
  buildFlowWarnings,
  flowPrivacyDelayProfileSummary,
  FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE,
  type FlowPhase,
  type FlowSnapshot,
} from "../services/workflow.js";
import {
  describeFlowPrivacyDelayDeadline,
  flowPrivacyDelayRangeSeconds,
  isFlowPrivacyDelayRandom,
  type FlowPrivacyDelayProfile,
} from "../utils/flow-privacy-delay.js";
import {
  displayDecimals,
  formatAddress,
  formatAmount,
  formatDenseOutcomeLine,
  formatUsdValue,
} from "../utils/format.js";
import { inlineSeparator } from "../utils/terminal.js";
import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  guardCsvUnsupported,
  info,
  isSilent,
  printJsonSuccess,
  renderNextSteps,
  success,
  warn,
} from "./common.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";
import { formatReviewSurface } from "./review.js";
import {
  renderFlowRail,
  type FlowRailStep,
} from "./progress.js";

export interface FlowJsonWarning {
  code: string;
  category: string;
  message: string;
}

export interface FlowStartReviewData {
  amount: bigint;
  feeAmount: bigint;
  estimatedCommitted: bigint;
  asset: string;
  chain: string;
  decimals: number;
  recipient: string;
  privacyDelaySummary: string;
  newWallet: boolean;
  isErc20: boolean;
  amountPatternWarning?: string | null;
  privacyDelayOff?: boolean;
  tokenPrice?: number | null;
}

function flowReviewUsdSuffix(
  amount: bigint,
  decimals: number,
  tokenPrice?: number | null,
): string {
  const formatted = formatUsdValue(amount, decimals, tokenPrice ?? null);
  return formatted === "-" ? "" : ` (${formatted})`;
}

export function formatFlowStartReview(data: FlowStartReviewData): string {
  return formatReviewSurface({
    title: "Flow start review",
    summaryRows: [
      {
        label: "Amount",
        value:
          `${formatAmount(data.amount, data.decimals, data.asset, displayDecimals(data.decimals))}` +
          flowReviewUsdSuffix(data.amount, data.decimals, data.tokenPrice),
      },
      { label: "Chain", value: data.chain },
      { label: "Recipient", value: data.recipient },
      {
        label: "Vetting fee",
        value:
          `${formatAmount(data.feeAmount, data.decimals, data.asset, displayDecimals(data.decimals))}` +
          flowReviewUsdSuffix(data.feeAmount, data.decimals, data.tokenPrice),
        valueTone: "warning",
      },
      {
        label: "Expected net deposited",
        value:
          `~${formatAmount(data.estimatedCommitted, data.decimals, data.asset, displayDecimals(data.decimals))}` +
          flowReviewUsdSuffix(data.estimatedCommitted, data.decimals, data.tokenPrice),
        valueTone: "success",
      },
      {
        label: "Privacy delay",
        value: data.privacyDelaySummary,
      },
      {
        label: "Wallet mode",
        value: data.newWallet ? "Dedicated workflow wallet" : "Configured wallet",
      },
    ],
    primaryCallout: {
      kind: "privacy",
      lines: [
        "This saved flow deposits publicly now, then waits for Association Set Provider (ASP) approval before requesting the relayed private withdrawal.",
        DEPOSIT_APPROVAL_TIMELINE_COPY,
        "The auto-withdrawal always spends the full approved Pool Account balance to the saved recipient.",
      ],
    },
    secondaryCallout: data.amountPatternWarning || data.privacyDelayOff || data.isErc20 || data.newWallet
      ? {
          kind: data.amountPatternWarning || data.privacyDelayOff ? "warning" : "read-only",
          lines: [
            ...(data.newWallet
              ? [
                  "Back up the dedicated workflow wallet before funding it.",
                ]
              : []),
            ...(data.isErc20
              ? [
                  "This uses 2 transactions: token approval + deposit.",
                ]
              : []),
            ...(data.privacyDelayOff
              ? [
                  FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE,
                ]
              : []),
            ...(data.amountPatternWarning ? [data.amountPatternWarning] : []),
          ],
        }
      : null,
  });
}

export interface FlowRenderData {
  action: "start" | "watch" | "status" | "ragequit";
  snapshot: FlowSnapshot;
  extraWarnings?: FlowJsonWarning[];
}

export function renderFlowPhaseChangeEvent(event: {
  workflowId: string;
  previousPhase: FlowPhase;
  phase: FlowPhase;
  ts: string;
}): void {
  printJsonSuccess({
    mode: "flow",
    action: "watch",
    event: "phase_change",
    workflowId: event.workflowId,
    previousPhase: event.previousPhase,
    phase: event.phase,
    ts: event.ts,
  }, false);
}

export interface FlowStartDryRunData {
  chain: string;
  asset: string;
  assetDecimals: number;
  depositAmount: bigint;
  recipient: string;
  walletMode: "configured" | "new_wallet";
  privacyDelayProfile: FlowPrivacyDelayProfile;
  vettingFee: bigint;
  estimatedCommittedValue: bigint;
  isErc20: boolean;
  tokenPrice?: number | null;
  warnings?: FlowJsonWarning[];
}

export function formatFlowRagequitReview(snapshot: FlowSnapshot): string {
  const amount = flowOutcomeAmount(snapshot);
  const destination = flowRecoveryDestination(snapshot);
  return formatReviewSurface({
    title: "Saved flow ragequit",
    summaryRows: [
      { label: "Workflow", value: snapshot.workflowId },
      { label: "Chain", value: snapshot.chain },
      { label: "Asset", value: snapshot.asset },
      ...(snapshot.poolAccountId
        ? [{ label: "Pool Account", value: snapshot.poolAccountId }]
        : []),
      ...(amount ? [{ label: "Amount", value: amount }] : []),
      { label: "Destination", value: destination },
      {
        label: "Privacy outcome",
        value: "no privacy (public recovery)",
        valueTone: "warning",
      },
    ],
    primaryCallout: {
      kind: "danger",
      lines: [
        `Recover funds publicly to your deposit address. This does not provide privacy for this saved workflow.${configuredSignerRecoverySuffix(snapshot)}`,
      ],
    },
  });
}

function flowRecoveryDestination(snapshot: FlowSnapshot): string {
  return snapshot.walletAddress ?? "original deposit address";
}

function flowRecoveryDestinationLabel(snapshot: FlowSnapshot): string {
  return snapshot.walletAddress
    ? formatAddress(snapshot.walletAddress)
    : "original deposit address";
}

function formatFlowAssetAmount(
  rawAmount: string | null | undefined,
  snapshot: FlowSnapshot,
): string | null {
  if (!rawAmount) return null;
  if (typeof snapshot.assetDecimals !== "number") {
    return rawAmount;
  }
  try {
    return formatAmount(
      BigInt(rawAmount),
      snapshot.assetDecimals,
      snapshot.asset,
      displayDecimals(snapshot.assetDecimals),
    );
  } catch {
    return rawAmount;
  }
}

function formatFlowNativeFunding(rawAmount: string | null | undefined): string | null {
  if (!rawAmount) return null;
  try {
    return formatAmount(BigInt(rawAmount), 18, "ETH", displayDecimals(18));
  } catch {
    return rawAmount;
  }
}

function phaseLabel(phase: FlowPhase): string {
  switch (phase) {
    case "awaiting_funding":
      return "Awaiting funding";
    case "depositing_publicly":
      return "Depositing publicly";
    case "awaiting_asp":
      return "Awaiting ASP approval";
    case "approved_waiting_privacy_delay":
      return "Approved and waiting for privacy delay";
    case "approved_ready_to_withdraw":
      return "Approved and ready to withdraw";
    case "withdrawing":
      return "Withdrawing";
    case "completed":
      return "Completed";
    case "completed_public_recovery":
      return "Completed via ragequit";
    case "paused_poa_required":
      return "Paused: Proof of Association required";
    case "paused_declined":
      return "Paused: declined";
    case "stopped_external":
      return "Stopped: account changed externally";
    default:
      return phase;
  }
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function formatFundingSummary(snapshot: FlowSnapshot): string | null {
  const fundingParts: string[] = [];
  const tokenFunding = formatFlowAssetAmount(
    snapshot.requiredTokenFunding,
    snapshot,
  );
  const nativeFunding = formatFlowNativeFunding(snapshot.requiredNativeFunding);
  if (tokenFunding) {
    fundingParts.push(tokenFunding);
  }
  if (nativeFunding) {
    fundingParts.push(nativeFunding);
  }

  return fundingParts.length > 0 ? joinWithAnd(fundingParts) : null;
}

function awaitingFundingReason(snapshot: FlowSnapshot): string {
  if (snapshot.walletMode !== "new_wallet") {
    return "Resume this saved workflow and continue toward the private withdrawal.";
  }

  const fundingSummary = formatFundingSummary(snapshot);
  if (fundingSummary) {
    return `Fund the dedicated workflow wallet with ${fundingSummary} first, then re-run flow watch to continue.`;
  }

  return "Fund the dedicated workflow wallet first, then re-run flow watch to continue.";
}

function privacyDelayWaitingReason(snapshot: FlowSnapshot): string {
  const delaySummary = describeFlowPrivacyDelayDeadline(
    snapshot.privacyDelayUntil,
  );
  if (delaySummary) {
    return `This workflow is holding until ${delaySummary} before requesting the relayed private withdrawal. Re-run flow watch after that time or keep it attached to continue automatically.`;
  }
  return "This workflow is still inside its saved privacy-delay window. Re-run flow watch when that hold expires to continue.";
}

function requiresPublicRecoveryBecauseRelayerMinimum(
  snapshot: FlowSnapshot,
): boolean {
  return snapshot.lastError?.errorCode === "FLOW_RELAYER_MINIMUM_BLOCKED";
}

function relayerMinimumRecoveryReason(snapshot: FlowSnapshot): string {
  return `This saved workflow cannot continue privately because the full remaining balance is below the relayer minimum. Use flow ragequit for public recovery instead.${configuredSignerRecoverySuffix(snapshot)}`;
}

function shouldExposeConfirmedPoolAccount(snapshot: FlowSnapshot): boolean {
  return Boolean(
    snapshot.depositBlockNumber ||
      snapshot.depositLabel ||
      snapshot.committedValue ||
      (snapshot.phase !== "awaiting_funding" &&
        snapshot.phase !== "depositing_publicly"),
  );
}

function configuredSignerRecoverySuffix(snapshot: FlowSnapshot): string {
  return (snapshot.walletMode ?? "configured") === "configured"
    ? " This configured-wallet workflow still requires the original depositor signer."
    : "";
}

function ragequitOptionalReason(snapshot: FlowSnapshot, base: string): string {
  return `${base}${configuredSignerRecoverySuffix(snapshot)}`;
}

function ragequitDeclinedReason(snapshot: FlowSnapshot, base: string): string {
  return `${base}${configuredSignerRecoverySuffix(snapshot)}`;
}

function flowOutcomeAmount(snapshot: FlowSnapshot): string | null {
  return formatFlowAssetAmount(
    snapshot.committedValue ?? snapshot.depositAmount,
    snapshot,
  );
}

function buildFlowRail(snapshot: FlowSnapshot, action: FlowRenderData["action"]): FlowRailStep[] {
  const publicRecoveryRequired = requiresPublicRecoveryBecauseRelayerMinimum(snapshot);
  const usesRecoveryLabel =
    action === "ragequit" ||
    snapshot.phase === "completed_public_recovery" ||
    snapshot.phase === "paused_declined" ||
    publicRecoveryRequired;
  const steps: FlowRailStep[] = [];

  const addStep = (
    label: string,
    state: FlowRailStep["state"],
    note?: string,
  ) => {
    steps.push({ label, state, ...(note ? { note } : {}) });
  };

  if (snapshot.walletMode === "new_wallet") {
    addStep(
      "Fund",
      snapshot.phase === "awaiting_funding" ? "active" : "done",
      snapshot.phase === "awaiting_funding"
        ? formatFundingSummary(snapshot) ?? "Fund the dedicated workflow wallet first."
        : undefined,
    );
  }

  addStep(
    "Deposit",
    snapshot.phase === "depositing_publicly"
      ? "active"
      : snapshot.phase === "awaiting_funding"
        ? "pending"
        : "done",
  );

  addStep(
    "Review",
    snapshot.phase === "awaiting_asp"
      ? "active"
      : snapshot.phase === "paused_declined" || snapshot.phase === "paused_poa_required"
        ? "blocked"
        : snapshot.phase === "awaiting_funding" || snapshot.phase === "depositing_publicly"
          ? "pending"
          : "done",
    snapshot.phase === "awaiting_asp"
      ? "Waiting for ASP approval."
      : snapshot.phase === "paused_declined"
        ? "Declined by the ASP."
        : snapshot.phase === "paused_poa_required"
          ? "Proof of Association is required before private withdrawal can continue."
          : undefined,
  );

  const delaySkipped = (snapshot.privacyDelayProfile ?? "off") === "off";
  addStep(
    "Delay",
    delaySkipped
      ? "skipped"
      : snapshot.phase === "approved_waiting_privacy_delay"
        ? "active"
        : snapshot.phase === "approved_ready_to_withdraw" ||
            snapshot.phase === "withdrawing" ||
            snapshot.phase === "completed" ||
            snapshot.phase === "completed_public_recovery"
          ? "done"
          : snapshot.phase === "paused_declined" || snapshot.phase === "paused_poa_required"
            ? "pending"
            : "pending",
    snapshot.phase === "approved_waiting_privacy_delay"
      ? describeFlowPrivacyDelayDeadline(snapshot.privacyDelayUntil) ??
        "Waiting through the saved privacy delay."
      : undefined,
  );

  addStep(
    usesRecoveryLabel ? "Recovery" : "Withdraw",
    action === "ragequit" || snapshot.phase === "completed_public_recovery"
      ? "done"
      : publicRecoveryRequired || snapshot.phase === "paused_declined"
        ? "blocked"
        : snapshot.phase === "paused_poa_required"
          ? "blocked"
          : snapshot.phase === "withdrawing" || snapshot.phase === "approved_ready_to_withdraw"
            ? "active"
            : snapshot.phase === "completed"
              ? "done"
              : "pending",
    action === "ragequit" || snapshot.phase === "completed_public_recovery"
      ? "Funds returned to the original deposit address."
      : publicRecoveryRequired
        ? "The saved full-balance withdrawal is below the relayer minimum, so public recovery is required."
        : snapshot.phase === "paused_declined"
          ? "Use flow ragequit to return funds to the original deposit address."
          : snapshot.phase === "paused_poa_required"
            ? "Complete Proof of Association to continue privately, or recover publicly instead."
            : snapshot.phase === "approved_ready_to_withdraw"
              ? "Ready for the relayed private withdrawal."
              : snapshot.phase === "withdrawing"
                ? "Withdrawal is being submitted or confirmed."
                : undefined,
  );

  return steps;
}

function buildStoppedExternalAgentNextAction(snapshot: FlowSnapshot) {
  return createNextAction(
    "accounts",
    `This saved workflow stopped after ${snapshot.poolAccountId ?? "the Pool Account"} changed externally. Inspect the latest account state, then choose the manual follow-up from the current account state.`,
    "flow_manual_followup",
    {
      options: { agent: true, chain: snapshot.chain },
    },
  );
}

function buildStoppedExternalHumanNextAction(snapshot: FlowSnapshot) {
  return createNextAction(
    "accounts",
    `Inspect ${snapshot.poolAccountId ?? "the affected Pool Account"} on ${snapshot.chain}, then choose the manual follow-up from the current account state.`,
    "flow_manual_followup",
    {
      options: { chain: snapshot.chain },
    },
  );
}

function buildAgentNextActions(snapshot: FlowSnapshot) {
  if (snapshot.ragequitTxHash && !snapshot.ragequitBlockNumber) {
    return [
      createNextAction(
        "flow ragequit",
        "A public recovery transaction was already submitted. Re-run flow ragequit to wait for confirmation.",
        "flow_public_recovery_pending",
        {
          args: [snapshot.workflowId],
          options: { agent: true },
        },
      ),
    ];
  }

  if (requiresPublicRecoveryBecauseRelayerMinimum(snapshot)) {
    return [
      createNextAction(
        "flow ragequit",
        relayerMinimumRecoveryReason(snapshot),
        "flow_public_recovery_required",
        {
          args: [snapshot.workflowId],
          options: { agent: true },
        },
      ),
    ];
  }

  switch (snapshot.phase) {
    case "awaiting_funding":
      return [
        createNextAction(
          "flow watch",
          awaitingFundingReason(snapshot),
          "flow_resume",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    case "depositing_publicly":
      return [
        createNextAction(
          "flow watch",
          "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    case "awaiting_asp":
    case "approved_ready_to_withdraw":
      return [
        createNextAction(
          "flow watch",
          "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    case "approved_waiting_privacy_delay":
      return [
        createNextAction(
          "flow watch",
          privacyDelayWaitingReason(snapshot),
          "flow_resume",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    case "withdrawing":
      return [
        createNextAction(
          "flow watch",
          "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    case "paused_poa_required":
      return [
        createNextAction(
          "flow watch",
          `Complete Proof of Association at ${POA_PORTAL_URL} first, then re-check this workflow to continue privately.`,
          "flow_resume",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
            runnable: false,
          },
        ),
        createNextAction(
          "flow ragequit",
          ragequitOptionalReason(
            snapshot,
            "Use flow ragequit instead if you want to recover publicly without completing Proof of Association.",
          ),
          "flow_public_recovery_optional",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    case "paused_declined":
      return [
        createNextAction(
          "flow ragequit",
          ragequitDeclinedReason(
            snapshot,
            "This workflow was declined. flow ragequit is the canonical saved-workflow public recovery path.",
          ),
          "flow_declined",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    case "stopped_external":
      return [buildStoppedExternalAgentNextAction(snapshot)];
    default:
      return [];
  }
}

function buildHumanNextActions(snapshot: FlowSnapshot) {
  if (snapshot.ragequitTxHash && !snapshot.ragequitBlockNumber) {
    return [
      createNextAction(
        "flow ragequit",
        "A public recovery transaction was already submitted, so re-run flow ragequit to wait for confirmation.",
        "flow_public_recovery_pending",
        {
          args: [snapshot.workflowId],
        },
      ),
    ];
  }

  if (requiresPublicRecoveryBecauseRelayerMinimum(snapshot)) {
    return [
      createNextAction(
        "flow ragequit",
        relayerMinimumRecoveryReason(snapshot),
        "flow_public_recovery_required",
        {
          args: [snapshot.workflowId],
        },
      ),
    ];
  }

  switch (snapshot.phase) {
    case "awaiting_funding":
      return [
        createNextAction(
          "flow watch",
          awaitingFundingReason(snapshot),
          "flow_resume",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "depositing_publicly":
      return [
        createNextAction(
          "flow watch",
          "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "awaiting_asp":
    case "approved_ready_to_withdraw":
      return [
        createNextAction(
          "flow watch",
          "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "approved_waiting_privacy_delay":
      return [
        createNextAction(
          "flow watch",
          privacyDelayWaitingReason(snapshot),
          "flow_resume",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "withdrawing":
      return [
        createNextAction(
          "flow watch",
          "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "paused_poa_required":
      return [
        createNextAction(
          "flow watch",
          `Complete Proof of Association at ${POA_PORTAL_URL}, then re-run the watcher to continue privately.`,
          "flow_resume",
          {
            args: [snapshot.workflowId],
          },
        ),
        createNextAction(
          "flow ragequit",
          ragequitOptionalReason(
            snapshot,
            "Use flow ragequit instead if you want to recover publicly without completing Proof of Association.",
          ),
          "flow_public_recovery_optional",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "paused_declined":
      return [
        createNextAction(
          "flow ragequit",
          ragequitDeclinedReason(
            snapshot,
            "This workflow was declined, so run flow ragequit to recover publicly to the original deposit address.",
          ),
          "flow_declined",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "stopped_external":
      return [buildStoppedExternalHumanNextAction(snapshot)];
    default:
      return [];
  }
}

function buildFlowJsonSnapshot(
  action: FlowRenderData["action"],
  snapshot: FlowSnapshot,
  extraWarnings: readonly FlowJsonWarning[] = [],
) {
  const warnings =
    action === "ragequit"
      ? []
      : buildFlowWarnings(snapshot, {
          forceConfiguredPrivacyDelayWarning:
            action === "start" || action === "watch",
        });
  const privacyDelayProfile = snapshot.privacyDelayProfile ?? "off";
  const exposedPoolAccount = shouldExposeConfirmedPoolAccount(snapshot);
  return {
    mode: "flow",
    action,
    workflowId: snapshot.workflowId,
    phase: snapshot.phase,
    walletMode: snapshot.walletMode ?? "configured",
    walletAddress: snapshot.walletAddress ?? null,
    requiredNativeFunding: snapshot.requiredNativeFunding ?? null,
    requiredTokenFunding: snapshot.requiredTokenFunding ?? null,
    backupConfirmed:
      snapshot.walletMode === "new_wallet"
        ? snapshot.backupConfirmed ?? false
        : undefined,
    privacyDelayProfile,
    privacyDelayConfigured: snapshot.privacyDelayConfigured ?? false,
    privacyDelayRandom: isFlowPrivacyDelayRandom(privacyDelayProfile),
    privacyDelayRangeSeconds: flowPrivacyDelayRangeSeconds(privacyDelayProfile),
    privacyDelayUntil: snapshot.privacyDelayUntil ?? null,
    chain: snapshot.chain,
    asset: snapshot.asset,
    depositAmount: snapshot.depositAmount,
    recipient: snapshot.recipient,
    poolAccountId: exposedPoolAccount ? snapshot.poolAccountId ?? null : null,
    poolAccountNumber:
      exposedPoolAccount ? snapshot.poolAccountNumber ?? null : null,
    depositTxHash: snapshot.depositTxHash ?? null,
    depositBlockNumber: snapshot.depositBlockNumber ?? null,
    depositExplorerUrl: snapshot.depositExplorerUrl ?? null,
    committedValue: snapshot.committedValue ?? null,
    aspStatus: snapshot.aspStatus,
    withdrawTxHash: snapshot.withdrawTxHash ?? null,
    withdrawBlockNumber: snapshot.withdrawBlockNumber ?? null,
    withdrawExplorerUrl: snapshot.withdrawExplorerUrl ?? null,
    ragequitTxHash: snapshot.ragequitTxHash ?? null,
    ragequitBlockNumber: snapshot.ragequitBlockNumber ?? null,
    ragequitExplorerUrl: snapshot.ragequitExplorerUrl ?? null,
    lastError: snapshot.lastError,
    privacyCostManifest: action === "ragequit"
      ? {
          action: "flow ragequit",
          framing: "public_self_custody_recovery",
          workflowId: snapshot.workflowId,
          poolAccountId: exposedPoolAccount ? snapshot.poolAccountId ?? null : null,
          amount: snapshot.committedValue ?? snapshot.depositAmount,
          asset: snapshot.asset,
          chain: snapshot.chain,
          destinationAddress: snapshot.walletAddress ?? null,
          privacyCost: "funds return publicly to the original depositing address",
          privacyPreserved: false,
          recommendation: "Prefer flow watch for a relayed private withdrawal when the workflow can continue privately.",
        }
      : undefined,
    warnings:
      warnings.length > 0 || extraWarnings.length > 0
        ? [...warnings, ...extraWarnings]
        : undefined,
  };
}

export function renderFlowStartDryRun(
  ctx: OutputContext,
  data: FlowStartDryRunData,
): void {
  guardCsvUnsupported(ctx, "flow start --dry-run");

  const privacyDelayRange = flowPrivacyDelayRangeSeconds(data.privacyDelayProfile);
  const privacyDelayRandom = isFlowPrivacyDelayRandom(data.privacyDelayProfile);
  const nextActionOptions: Record<string, string | boolean> = {
    agent: true,
    chain: data.chain,
    to: data.recipient,
    privacyDelay: data.privacyDelayProfile,
  };
  if (data.walletMode === "new_wallet") {
    nextActionOptions.newWallet = true;
  }

  const agentNextActions = [
    createNextAction(
      "flow start",
      "Start this saved workflow for real when you are ready to deposit.",
      "after_dry_run",
      {
        args: [
          formatUnits(data.depositAmount, data.assetDecimals),
          data.asset,
        ],
        options: nextActionOptions,
        runnable: data.walletMode === "configured",
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions(
        {
          mode: "flow",
          action: "start",
          dryRun: true,
          chain: data.chain,
          asset: data.asset,
          depositAmount: data.depositAmount.toString(),
          recipient: data.recipient,
          walletMode: data.walletMode,
          privacyDelayProfile: data.privacyDelayProfile,
          privacyDelayConfigured: true,
          privacyDelayRandom,
          privacyDelayRangeSeconds: privacyDelayRange,
          vettingFee: data.vettingFee.toString(),
          estimatedCommittedValue: data.estimatedCommittedValue.toString(),
          warnings: data.warnings && data.warnings.length > 0
            ? data.warnings
            : undefined,
        },
        agentNextActions,
      ),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Flow dry-run complete. No workflow was saved and no transaction was submitted.", silent);
  if (!silent) {
    process.stderr.write(
      formatFlowStartReview({
        amount: data.depositAmount,
        feeAmount: data.vettingFee,
        estimatedCommitted: data.estimatedCommittedValue,
        asset: data.asset,
        chain: data.chain,
        decimals: data.assetDecimals,
        recipient: data.recipient,
        privacyDelaySummary: flowPrivacyDelayProfileSummary(
          data.privacyDelayProfile,
        ),
        newWallet: data.walletMode === "new_wallet",
        isErc20: data.isErc20,
        tokenPrice: data.tokenPrice ?? null,
      }),
    );
  }
}

export function renderFlowResult(ctx: OutputContext, data: FlowRenderData): void {
  guardCsvUnsupported(ctx, "flow");
  const agentNextActions = buildAgentNextActions(data.snapshot);
  const humanNextActions = buildHumanNextActions(data.snapshot);

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions(
        buildFlowJsonSnapshot(data.action, data.snapshot, data.extraWarnings),
        agentNextActions,
      ),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const warnings =
    data.action === "ragequit"
      ? []
      : buildFlowWarnings(data.snapshot, {
          forceConfiguredPrivacyDelayWarning:
            data.action === "start" || data.action === "watch",
        });
  const usesPublicRecoveryPath =
    data.action === "ragequit" ||
    data.snapshot.phase === "completed_public_recovery" ||
    Boolean(data.snapshot.ragequitTxHash);

  if (data.snapshot.ragequitTxHash && !data.snapshot.ragequitBlockNumber) {
    info(
      `Workflow ${data.snapshot.workflowId} already submitted the public recovery transaction and is waiting for confirmation.`,
      silent,
    );
  } else if (data.snapshot.phase === "paused_declined") {
    warn(
      `${data.snapshot.poolAccountId ?? "This workflow"} was declined by the ASP. This saved workflow is paused and ready for public recovery via flow ragequit.${configuredSignerRecoverySuffix(data.snapshot)}`,
      silent,
    );
  } else if (data.snapshot.phase === "paused_poa_required") {
    warn(
      `${data.snapshot.poolAccountId ?? "This workflow"} needs Proof of Association before the private withdrawal can continue. Complete PoA to continue privately, or use flow ragequit to recover publicly.${configuredSignerRecoverySuffix(data.snapshot)}`,
      silent,
    );
  } else if (
    data.snapshot.phase === "approved_waiting_privacy_delay" &&
    data.snapshot.privacyDelayUntil
  ) {
    const delaySummary =
      describeFlowPrivacyDelayDeadline(data.snapshot.privacyDelayUntil) ??
      data.snapshot.privacyDelayUntil;
    info(
      `ASP approval is confirmed. This workflow is intentionally waiting until ${delaySummary} before requesting the private withdrawal.`,
      silent,
    );
  } else if (data.snapshot.phase === "stopped_external") {
    warn(
      `${data.snapshot.poolAccountId ?? "This workflow"} changed outside this saved workflow. Inspect the latest account state, then choose the right manual next step from there.`,
      silent,
    );
  } else if (requiresPublicRecoveryBecauseRelayerMinimum(data.snapshot)) {
    warn(relayerMinimumRecoveryReason(data.snapshot), silent);
  } else if (data.action === "start") {
    if (data.snapshot.phase === "awaiting_funding" && data.snapshot.walletAddress) {
      success(
        `Workflow ${data.snapshot.workflowId} started with a dedicated wallet at ${data.snapshot.walletAddress}.`,
        silent,
      );
    } else {
      success(
        `Flow started for ${data.snapshot.poolAccountId}. Your deposit is onchain and under review. Run flow watch to continue toward the private withdrawal once approved.`,
        silent,
      );
    }
  } else if (
    data.action === "ragequit" ||
    data.snapshot.phase === "completed" ||
    data.snapshot.phase === "completed_public_recovery"
  ) {
    // Terminal flow outcomes use the dense receipt line below as the primary
    // success surface instead of duplicating it with a status sentence here.
  } else {
    info(
      `Workflow ${data.snapshot.workflowId} is ${phaseLabel(data.snapshot.phase).toLowerCase()}.`,
      silent,
    );
  }

  if (data.action === "status") {
    if (!silent) {
      process.stderr.write(
        formatCallout(
          "read-only",
          "This is the saved local workflow snapshot. Run flow watch for a live re-check and to advance it.",
        ),
      );
    }
  }

  if (!silent) {
    process.stderr.write(`\n${renderFlowRail(buildFlowRail(data.snapshot, data.action))}`);
  }

  const phase = data.snapshot.phase;
  const publicRecoveryRequired = requiresPublicRecoveryBecauseRelayerMinimum(
    data.snapshot,
  );
  const isTerminal = phase === "completed" || phase === "completed_public_recovery";
  const isFunding = phase === "awaiting_funding";
  const isPreDeposit = isFunding || phase === "depositing_publicly";
  const committedValue = formatFlowAssetAmount(
    data.snapshot.committedValue,
    data.snapshot,
  );
  const depositAmount = formatFlowAssetAmount(
    data.snapshot.depositAmount,
    data.snapshot,
  );
  const requiredTokenFunding = formatFlowAssetAmount(
    data.snapshot.requiredTokenFunding,
    data.snapshot,
  );
  const requiredNativeFunding = formatFlowNativeFunding(
    data.snapshot.requiredNativeFunding,
  );
  const privacyDelaySummary = flowPrivacyDelayProfileSummary(
    data.snapshot.privacyDelayProfile ?? "off",
    data.snapshot.privacyDelayConfigured ?? false,
  );
  const showFullBalanceNote =
    !publicRecoveryRequired &&
    phase === "awaiting_asp" &&
    data.action !== "ragequit";
  const inlinePrivacyWarnings =
    phase === "awaiting_asp";
  const showPrivacyWarnings =
    !isTerminal &&
    !publicRecoveryRequired &&
    phase !== "withdrawing" &&
    phase !== "paused_declined" &&
    phase !== "paused_poa_required" &&
    phase !== "stopped_external" &&
    !inlinePrivacyWarnings;

  if (!silent) {
    if (phase === "completed" && data.snapshot.recipient) {
      process.stderr.write(
        formatDenseOutcomeLine({
          outcome: "withdraw",
          message:
            `Completed saved flow${
              flowOutcomeAmount(data.snapshot)
                ? `${inlineSeparator()}${flowOutcomeAmount(data.snapshot)}`
                : ""
            } ` +
            `-> ${formatAddress(data.snapshot.recipient)}${inlineSeparator()}${data.snapshot.poolAccountId ?? data.snapshot.workflowId}` +
            (data.snapshot.withdrawBlockNumber
              ? `${inlineSeparator()}Block ${data.snapshot.withdrawBlockNumber}`
              : ""),
          url: data.snapshot.withdrawExplorerUrl,
        }),
      );
    } else if (
      data.action === "ragequit" ||
      phase === "completed_public_recovery"
    ) {
      process.stderr.write(
        formatDenseOutcomeLine({
          outcome: "recovery",
          message:
            `Ragequit saved flow${
              flowOutcomeAmount(data.snapshot)
                ? `${inlineSeparator()}${flowOutcomeAmount(data.snapshot)}`
                : ""
            } ` +
            `-> ${flowRecoveryDestinationLabel(data.snapshot)}${inlineSeparator()}${data.snapshot.poolAccountId ?? data.snapshot.workflowId}` +
            (data.snapshot.ragequitBlockNumber
              ? `${inlineSeparator()}Block ${data.snapshot.ragequitBlockNumber}`
              : ""),
          url: data.snapshot.ragequitExplorerUrl,
        }),
      );
    }

    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    const summaryRows = [
      { label: "Workflow", value: data.snapshot.workflowId },
      {
        label: "Phase",
        value: publicRecoveryRequired ? "Public recovery required" : phaseLabel(phase),
      },
      { label: "Chain", value: data.snapshot.chain },
      { label: "Asset", value: data.snapshot.asset },
      {
        label: usesPublicRecoveryPath
          ? "Public recovery destination"
          : "Recipient",
        value: usesPublicRecoveryPath
          ? flowRecoveryDestination(data.snapshot)
          : data.snapshot.recipient,
      },
      ...(shouldExposeConfirmedPoolAccount(data.snapshot) &&
      data.snapshot.poolAccountId
        ? [{ label: "Pool Account", value: data.snapshot.poolAccountId }]
        : []),
      ...(data.snapshot.walletMode === "new_wallet" && data.snapshot.walletAddress
        ? [{ label: "Wallet", value: data.snapshot.walletAddress }]
        : []),
    ];
    process.stderr.write(formatKeyValueRows(summaryRows));
  }

  if (!silent) {
    const phaseRows: Array<{
      label: string;
      value: string;
      valueTone?: "default" | "accent" | "success" | "warning" | "danger" | "muted";
    }> = [];
    let phaseSectionTitle = "Progress";
    let phaseCalloutKind:
      | "success"
      | "warning"
      | "danger"
      | "privacy"
      | "recovery"
      | "read-only"
      | null = null;
    let phaseCalloutLines: string[] = [];

    switch (phase) {
      case "awaiting_funding":
        phaseSectionTitle = "Funding required";
        if (depositAmount) {
          phaseRows.push({ label: "Deposit target", value: depositAmount });
        }
        if (requiredTokenFunding) {
          phaseRows.push({
            label: "Token funding",
            value: requiredTokenFunding,
            valueTone: "accent",
          });
        }
        if (requiredNativeFunding) {
          phaseRows.push({
            label: "Native gas",
            value: requiredNativeFunding,
            valueTone: "accent",
          });
        }
        phaseCalloutKind = "recovery";
        phaseCalloutLines = [
          data.snapshot.walletMode === "new_wallet"
            ? "Fund the dedicated workflow wallet first. The flow cannot deposit until the required balances arrive at that same address."
            : "Re-run flow watch after funding is ready to continue toward the private withdrawal.",
        ];
        break;
      case "depositing_publicly":
        phaseSectionTitle = "Public deposit";
        if (depositAmount) {
          phaseRows.push({ label: "Deposit target", value: depositAmount });
        }
        phaseCalloutKind = "read-only";
        phaseCalloutLines = [
          "The public deposit is being submitted or confirmed in the saved workflow.",
          "Re-run flow watch to keep this workflow moving once the deposit is visible.",
        ];
        break;
      case "awaiting_asp":
        phaseSectionTitle = "ASP review";
        if (committedValue) {
          phaseRows.push({
            label: "Net deposited",
            value: `${committedValue} (net after vetting fee)`,
          });
        }
        phaseRows.push({
          label: "Privacy delay",
          value: privacyDelaySummary,
        });
        phaseCalloutKind = "read-only";
        phaseCalloutLines = [
          "The public deposit is confirmed and waiting for ASP review before any private withdrawal can begin.",
        ];
        break;
      case "approved_waiting_privacy_delay":
        phaseSectionTitle = "Privacy delay";
        if (committedValue) {
          phaseRows.push({
            label: "Approved balance",
            value: committedValue,
            valueTone: "success",
          });
        }
        phaseRows.push({
          label: "Privacy delay",
          value: privacyDelaySummary,
        });
        if (data.snapshot.privacyDelayUntil) {
          phaseRows.push({
            label: "Delay ends",
            value:
              describeFlowPrivacyDelayDeadline(data.snapshot.privacyDelayUntil) ??
              data.snapshot.privacyDelayUntil,
            valueTone: "accent",
          });
        }
        phaseCalloutKind = "privacy";
        phaseCalloutLines = [
          privacyDelayWaitingReason(data.snapshot),
        ];
        break;
      case "approved_ready_to_withdraw":
        phaseSectionTitle = publicRecoveryRequired
          ? "Public recovery required"
          : "Ready for private withdrawal";
        if (committedValue) {
          phaseRows.push({
            label: publicRecoveryRequired ? "Blocked balance" : "Approved balance",
            value: committedValue,
            valueTone: publicRecoveryRequired ? "danger" : "success",
          });
        }
        if (!publicRecoveryRequired) {
          phaseRows.push({
            label: "Privacy delay",
            value: privacyDelaySummary,
          });
        }
        phaseCalloutKind = publicRecoveryRequired ? "recovery" : "success";
        phaseCalloutLines = publicRecoveryRequired
          ? [relayerMinimumRecoveryReason(data.snapshot)]
          : [
              "The saved workflow is clear to request its relayed private withdrawal on the next flow watch run.",
            ];
        break;
      case "withdrawing":
        phaseSectionTitle = "Withdrawal in progress";
        if (committedValue) {
          phaseRows.push({
            label: "Approved balance",
            value: committedValue,
          });
        }
        if (data.snapshot.withdrawTxHash) {
          phaseRows.push({
            label: "Relay tx",
            value: data.snapshot.withdrawTxHash,
            valueTone: "accent",
          });
        }
        phaseCalloutKind = "read-only";
        phaseCalloutLines = [
          "The relayed private withdrawal has been requested and is being confirmed onchain.",
          "Re-run flow watch to confirm the receipt if this workflow remains in-flight.",
        ];
        break;
      case "paused_declined":
        phaseSectionTitle = "Recovery decision";
        if (committedValue) {
          phaseRows.push({
            label: "Blocked balance",
            value: committedValue,
            valueTone: "danger",
          });
        }
        phaseCalloutKind = "recovery";
        phaseCalloutLines = [
          `This workflow was declined by the ASP. Your funds can still return safely to ${flowRecoveryDestination(data.snapshot)} with privacy-pools flow ragequit ${data.snapshot.workflowId}. Privacy will not be preserved.${configuredSignerRecoverySuffix(data.snapshot)}`,
        ];
        break;
      case "paused_poa_required":
        phaseSectionTitle = "Recovery decision";
        if (committedValue) {
          phaseRows.push({
            label: "Blocked balance",
            value: committedValue,
            valueTone: "warning",
          });
        }
        phaseCalloutKind = "recovery";
        phaseCalloutLines = [
          `Complete Proof of Association at ${POA_PORTAL_URL} to continue privately, or use flow ragequit if you prefer the safe public recovery path back to ${flowRecoveryDestination(data.snapshot)}.${configuredSignerRecoverySuffix(data.snapshot)}`,
        ];
        break;
      case "stopped_external":
        phaseSectionTitle = "Manual follow-up";
        if (committedValue) {
          phaseRows.push({
            label: "Last known balance",
            value: committedValue,
            valueTone: "warning",
          });
        }
        phaseCalloutKind = "recovery";
        phaseCalloutLines = [
          `Inspect accounts on ${data.snapshot.chain}, then choose the manual follow-up from the current Pool Account state.`,
        ];
        break;
      case "completed":
        phaseSectionTitle = "Completed";
        if (committedValue) {
          phaseRows.push({
            label: "Withdrawn privately",
            value: committedValue,
            valueTone: "success",
          });
        }
        phaseCalloutKind = "success";
        phaseCalloutLines = [
          "The saved flow finished its private withdrawal path.",
        ];
        break;
      case "completed_public_recovery":
        phaseSectionTitle = "Completed via ragequit";
        if (committedValue) {
          phaseRows.push({
            label: "Ragequit amount",
            value: committedValue,
            valueTone: "warning",
          });
        }
        phaseCalloutKind = "warning";
        phaseCalloutLines = [
          `The saved workflow finished on the public recovery path. Funds returned safely to ${flowRecoveryDestination(data.snapshot)}, but privacy was not preserved.`,
        ];
        break;
    }

    if (phaseRows.length > 0) {
      process.stderr.write(
        formatSectionHeading(phaseSectionTitle, { divider: true }),
      );
      process.stderr.write(formatKeyValueRows(phaseRows));
    }
    if (phaseCalloutKind && phaseCalloutLines.length > 0) {
      process.stderr.write(formatCallout(phaseCalloutKind, phaseCalloutLines));
    }
    if (showFullBalanceNote) {
      process.stderr.write(
        formatCallout(
          "privacy",
          "This saved flow withdraws the full remaining Pool Account balance. The recipient receives the net amount after relayer fees.",
        ),
      );
    }
  }

  const privacyWarningLines = showPrivacyWarnings
    ? warnings.map((flowWarning) => flowWarning.message)
    : [];
  const operationalWarningLines =
    data.snapshot.walletMode === "new_wallet" &&
    (isTerminal ||
      phase === "paused_declined" ||
      phase === "paused_poa_required" ||
      phase === "stopped_external")
      ? [
          "Any leftover funds or gas reserve remain in the dedicated workflow wallet until you move them manually.",
        ]
      : [];
  if (privacyWarningLines.length > 0 && !silent) {
    process.stderr.write(formatCallout("privacy", privacyWarningLines));
  }
  if (operationalWarningLines.length > 0 && !silent) {
    process.stderr.write(formatCallout("warning", operationalWarningLines));
  }

  const showOptionalPublicRecovery =
    data.action === "status" &&
    !usesPublicRecoveryPath &&
    !isTerminal &&
    !isPreDeposit &&
    phase !== "withdrawing" &&
    phase !== "paused_declined" &&
    phase !== "paused_poa_required" &&
    phase !== "stopped_external" &&
    !requiresPublicRecoveryBecauseRelayerMinimum(data.snapshot);
  const transactionRows = [];
  if (data.snapshot.depositExplorerUrl && !isPreDeposit) {
    transactionRows.push({
      label: "Deposit",
      value: data.snapshot.depositExplorerUrl,
    });
  }
  if (isTerminal || data.action === "ragequit") {
    if (data.snapshot.withdrawExplorerUrl) {
      transactionRows.push({
        label: "Withdrawal",
        value: data.snapshot.withdrawExplorerUrl,
      });
    }
    if (data.snapshot.ragequitExplorerUrl) {
      transactionRows.push({
        label: "Public recovery",
        value: data.snapshot.ragequitExplorerUrl,
      });
    }
  }
  if (transactionRows.length > 0 && !silent) {
    process.stderr.write(formatSectionHeading("Transactions", { divider: true }));
    process.stderr.write(formatKeyValueRows(transactionRows));
  }

  const recoveryRows = [];
  if (phase === "paused_poa_required") {
    recoveryRows.push({
      label: "Continue privately",
      value: POA_PORTAL_URL,
    });
    recoveryRows.push({
      label: "Recover publicly",
      value: `privacy-pools flow ragequit ${data.snapshot.workflowId}`,
    });
  } else if (
    phase === "paused_declined" ||
    requiresPublicRecoveryBecauseRelayerMinimum(data.snapshot)
  ) {
    recoveryRows.push({
      label: "Recover publicly",
      value: `privacy-pools flow ragequit ${data.snapshot.workflowId}`,
    });
  } else if (phase === "stopped_external") {
    recoveryRows.push({
      label: "Inspect accounts",
      value: `privacy-pools accounts --chain ${data.snapshot.chain}`,
    });
  } else if (showOptionalPublicRecovery) {
    recoveryRows.push({
      label: "Optional public recovery",
      value: `privacy-pools flow ragequit ${data.snapshot.workflowId}`,
    });
  }

  if (recoveryRows.length > 0 && !silent) {
    process.stderr.write(formatSectionHeading("Recovery", { divider: true }));
    process.stderr.write(formatKeyValueRows(recoveryRows));
  }

  if (data.snapshot.lastError) {
    if (!silent) {
      process.stderr.write(formatSectionHeading("Last error", { divider: true }));
    }
    warn(
      `Last error (${data.snapshot.lastError.step}): ${data.snapshot.lastError.errorMessage}`,
      silent,
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
