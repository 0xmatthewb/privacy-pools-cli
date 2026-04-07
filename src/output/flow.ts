import { POA_PORTAL_URL } from "../config/chains.js";
import {
  buildFlowWarnings,
  flowPrivacyDelayProfileSummary,
  type FlowPhase,
  type FlowSnapshot,
} from "../services/workflow.js";
import { describeFlowPrivacyDelayDeadline } from "../utils/flow-privacy-delay.js";
import { displayDecimals, formatAmount } from "../utils/format.js";
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

export interface FlowRenderData {
  action: "start" | "watch" | "status" | "ragequit";
  snapshot: FlowSnapshot;
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
      return "Completed via public recovery";
    case "paused_poi_required":
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
    return `This workflow is intentionally waiting until ${delaySummary} before requesting the private withdrawal. Re-run flow watch to keep watching or after that time to continue.`;
  }
  return "This workflow is intentionally waiting for the saved privacy-delay window to expire before requesting the private withdrawal. Re-run flow watch to continue.";
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
    case "paused_poi_required":
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
    case "paused_poi_required":
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

function buildFlowJsonSnapshot(action: FlowRenderData["action"], snapshot: FlowSnapshot) {
  const warnings =
    action === "ragequit"
      ? []
      : buildFlowWarnings(snapshot, {
          forceConfiguredPrivacyDelayWarning:
            action === "start" || action === "watch",
        });
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
    privacyDelayProfile: snapshot.privacyDelayProfile ?? "off",
    privacyDelayConfigured: snapshot.privacyDelayConfigured ?? false,
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
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function renderFlowResult(ctx: OutputContext, data: FlowRenderData): void {
  guardCsvUnsupported(ctx, "flow");
  const agentNextActions = buildAgentNextActions(data.snapshot);
  const humanNextActions = buildHumanNextActions(data.snapshot);

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions(
        buildFlowJsonSnapshot(data.action, data.snapshot),
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

  if (data.action === "ragequit") {
    success(
      `Workflow ${data.snapshot.workflowId} recovered funds publicly from ${data.snapshot.poolAccountId} to the original deposit address. Privacy was not preserved.`,
      silent,
    );
  } else if (data.snapshot.phase === "completed") {
    success(
      `Flow completed for ${data.snapshot.poolAccountId}. The approved deposit was withdrawn privately to ${data.snapshot.recipient}.`,
      silent,
    );
  } else if (data.snapshot.phase === "completed_public_recovery") {
    success(
      `Workflow ${data.snapshot.workflowId} recovered funds publicly to the original deposit address. Privacy was not preserved.`,
      silent,
    );
  } else if (data.snapshot.ragequitTxHash && !data.snapshot.ragequitBlockNumber) {
    info(
      `Workflow ${data.snapshot.workflowId} already submitted the public recovery transaction and is waiting for confirmation.`,
      silent,
    );
  } else if (data.snapshot.phase === "paused_declined") {
    warn(
      `${data.snapshot.poolAccountId ?? "This workflow"} was declined by the ASP. This saved workflow is paused and ready for public recovery via flow ragequit.${configuredSignerRecoverySuffix(data.snapshot)}`,
      silent,
    );
  } else if (data.snapshot.phase === "paused_poi_required") {
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
        `Flow started for ${data.snapshot.poolAccountId}. Your deposit is on-chain and under review. Run flow watch to continue toward the private withdrawal once approved.`,
        silent,
      );
    }
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

  const phase = data.snapshot.phase;
  const isTerminal = phase === "completed" || phase === "completed_public_recovery";
  const isFunding = phase === "awaiting_funding";
  const isPreDeposit = isFunding || phase === "depositing_publicly";
  const isWaitingDelay = phase === "approved_waiting_privacy_delay";

  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    const summaryRows = [
      { label: "Workflow", value: data.snapshot.workflowId },
      { label: "Phase", value: phaseLabel(phase) },
      { label: "Chain", value: data.snapshot.chain },
      { label: "Asset", value: data.snapshot.asset },
      {
        label: usesPublicRecoveryPath
          ? "Public recovery destination"
          : "Recipient",
        value: usesPublicRecoveryPath
          ? "original deposit address"
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

  // ── Funding phase: show what's needed to proceed ──
  if (isFunding) {
    const fundingRows = [];
    const requiredTokenFunding = formatFlowAssetAmount(
      data.snapshot.requiredTokenFunding,
      data.snapshot,
    );
    if (requiredTokenFunding) {
      fundingRows.push({
        label: "Required token amount",
        value: requiredTokenFunding,
      });
    }
    const requiredNativeFunding = formatFlowNativeFunding(
      data.snapshot.requiredNativeFunding,
    );
    if (requiredNativeFunding) {
      fundingRows.push({
        label: "Required native gas",
        value: requiredNativeFunding,
      });
    }

    if (!silent && fundingRows.length > 0) {
      process.stderr.write(formatSectionHeading("Funding", { divider: true }));
      process.stderr.write(formatKeyValueRows(fundingRows));
    }
  }

  // ── Pre-deposit: show deposit amount ──
  if (isPreDeposit) {
    const depositAmount = formatFlowAssetAmount(
      data.snapshot.depositAmount,
      data.snapshot,
    );
    if (!silent && depositAmount) {
      process.stderr.write(formatSectionHeading("Deposit", { divider: true }));
      process.stderr.write(
        formatKeyValueRows([{ label: "Deposit amount", value: depositAmount }]),
      );
    }
  }

  // ── Post-deposit: show deposited amount (net after vetting fee) ──
  if (!isPreDeposit) {
    const committedValue = formatFlowAssetAmount(
      data.snapshot.committedValue,
      data.snapshot,
    );
    if (!silent && committedValue) {
      process.stderr.write(formatSectionHeading("Deposit", { divider: true }));
      process.stderr.write(
        formatKeyValueRows([
          {
            label: "Deposited",
            value: `${committedValue} (net after vetting fee)`,
          },
        ]),
      );
    }
  }

  // ── Privacy delay: show profile when relevant, deadline when actively waiting ──
  if (isWaitingDelay || phase === "awaiting_asp" || phase === "approved_ready_to_withdraw") {
    const privacyDelayRows = [
      {
        label: "Privacy delay",
        value: flowPrivacyDelayProfileSummary(
        data.snapshot.privacyDelayProfile ?? "off",
        data.snapshot.privacyDelayConfigured ?? false,
        ),
      },
      ...(isWaitingDelay && data.snapshot.privacyDelayUntil
        ? [
            {
              label: "Privacy delay until",
              value:
                describeFlowPrivacyDelayDeadline(data.snapshot.privacyDelayUntil) ??
                data.snapshot.privacyDelayUntil,
            },
          ]
        : []),
    ];
    if (!silent) {
      process.stderr.write(formatSectionHeading("Privacy delay", { divider: true }));
      process.stderr.write(formatKeyValueRows(privacyDelayRows));
    }
  }

  // ── Full-balance note: important context for active flows ──
  if (
    !isTerminal &&
    !isPreDeposit &&
    data.action !== "ragequit"
  ) {
    info(
      "This flow withdraws the full Pool Account balance. You receive the net amount after fees.",
      silent,
    );
  }

  // ── Warnings ──
  const warningLines = warnings.map((flowWarning) => flowWarning.message);
  if (
    data.snapshot.walletMode === "new_wallet" &&
    (isTerminal ||
      phase === "paused_declined" ||
      phase === "paused_poi_required" ||
      phase === "stopped_external")
  ) {
    warningLines.push(
      "Any leftover funds or gas reserve remain in the dedicated workflow wallet until you move them manually.",
    );
  }
  if (warningLines.length > 0 && !silent) {
    process.stderr.write(formatCallout("warning", warningLines));
  }

  // ── Transaction links: only show the relevant one ──
  const showOptionalPublicRecovery =
    data.action === "status" &&
    !usesPublicRecoveryPath &&
    !isTerminal &&
    !isPreDeposit &&
    phase !== "withdrawing" &&
    phase !== "paused_declined" &&
    phase !== "paused_poi_required" &&
    !requiresPublicRecoveryBecauseRelayerMinimum(data.snapshot);
  const hasRecoverySection =
    isTerminal ||
    data.action === "ragequit" ||
    (data.snapshot.depositExplorerUrl && !isPreDeposit) ||
    showOptionalPublicRecovery ||
    phase === "paused_poi_required" ||
    phase === "stopped_external";
  const recoveryRows = [];
  if (isTerminal || data.action === "ragequit") {
    if (data.snapshot.withdrawExplorerUrl) {
      recoveryRows.push({
        label: "Withdrawal",
        value: data.snapshot.withdrawExplorerUrl,
      });
    } else if (data.snapshot.ragequitExplorerUrl) {
      recoveryRows.push({
        label: "Public recovery",
        value: data.snapshot.ragequitExplorerUrl,
      });
    }
    if (data.snapshot.depositExplorerUrl) {
      recoveryRows.push({
        label: "Deposit",
        value: data.snapshot.depositExplorerUrl,
      });
    }
  } else if (data.snapshot.depositExplorerUrl && !isPreDeposit) {
    recoveryRows.push({
      label: "Deposit",
      value: data.snapshot.depositExplorerUrl,
    });
  }

  if (showOptionalPublicRecovery) {
    recoveryRows.push({
      label: "Optional public recovery",
      value: `privacy-pools flow ragequit ${data.snapshot.workflowId}.${configuredSignerRecoverySuffix(data.snapshot)}`,
    });
  }

  if (hasRecoverySection && !silent) {
    process.stderr.write(formatSectionHeading("Recovery", { divider: true }));
    process.stderr.write(formatKeyValueRows(recoveryRows));
  }

  // ── Phase-specific guidance ──
  if (phase === "paused_poi_required") {
    info(
      `Complete Proof of Association at ${POA_PORTAL_URL}, then re-run this workflow watcher.`,
      silent,
    );
  }
  if (phase === "stopped_external") {
    info(
      `Inspect accounts on ${data.snapshot.chain}, then choose the manual follow-up from the current account state.`,
      silent,
    );
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
