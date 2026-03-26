import { POA_PORTAL_URL } from "../config/chains.js";
import type { FlowPhase, FlowSnapshot } from "../services/workflow.js";
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

  switch (snapshot.phase) {
    case "awaiting_funding":
    case "awaiting_asp":
    case "approved_ready_to_withdraw":
    case "withdrawing":
    case "depositing_publicly":
    case "paused_poi_required":
      return [
        createNextAction(
          "flow watch",
          snapshot.phase === "paused_poi_required"
            ? "Re-check this workflow after completing Proof of Association externally."
            : "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
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
          "This workflow was declined. flow ragequit is the canonical saved-workflow recovery path.",
          "flow_declined",
          {
            args: [snapshot.workflowId],
            options: { agent: true },
          },
        ),
      ];
    default:
      return [];
  }
}

function buildHumanNextActions(snapshot: FlowSnapshot) {
  if (snapshot.ragequitTxHash && !snapshot.ragequitBlockNumber) {
    return [
      createNextAction(
        "flow ragequit",
        "A public recovery transaction was already submitted, so re-run ragequit to wait for confirmation.",
        "flow_public_recovery_pending",
        {
          args: [snapshot.workflowId],
        },
      ),
    ];
  }

  switch (snapshot.phase) {
    case "awaiting_funding":
    case "awaiting_asp":
    case "approved_ready_to_withdraw":
    case "withdrawing":
    case "depositing_publicly":
    case "paused_poi_required":
      return [
        createNextAction(
          "flow watch",
          snapshot.phase === "paused_poi_required"
            ? "Complete Proof of Association externally first, then re-run the watcher."
            : "Resume this saved workflow and continue toward the private withdrawal.",
          "flow_resume",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    case "paused_declined":
      return [
        createNextAction(
          "flow ragequit",
          "This workflow was declined, so the saved easy path cannot finish privately.",
          "flow_declined",
          {
            args: [snapshot.workflowId],
          },
        ),
      ];
    default:
      return [];
  }
}

function buildFlowJsonSnapshot(action: FlowRenderData["action"], snapshot: FlowSnapshot) {
  return {
    mode: "flow",
    action,
    workflowId: snapshot.workflowId,
    phase: snapshot.phase,
    walletMode: snapshot.walletMode ?? "configured",
    walletAddress: snapshot.walletAddress ?? null,
    requiredNativeFunding: snapshot.requiredNativeFunding ?? null,
    requiredTokenFunding: snapshot.requiredTokenFunding ?? null,
    backupConfirmed: snapshot.backupConfirmed ?? false,
    chain: snapshot.chain,
    asset: snapshot.asset,
    depositAmount: snapshot.depositAmount,
    recipient: snapshot.recipient,
    poolAccountId: snapshot.poolAccountId ?? null,
    poolAccountNumber: snapshot.poolAccountNumber ?? null,
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

  if (data.snapshot.phase === "completed") {
    success(
      `Flow completed for ${data.snapshot.poolAccountId}. The approved deposit was withdrawn privately to ${data.snapshot.recipient}.`,
      silent,
    );
  } else if (data.snapshot.phase === "completed_public_recovery") {
    success(
      `Workflow ${data.snapshot.workflowId} completed on the public recovery path.`,
      silent,
    );
  } else if (data.snapshot.ragequitTxHash && !data.snapshot.ragequitBlockNumber) {
    info(
      `Workflow ${data.snapshot.workflowId} already submitted the public recovery transaction and is waiting for confirmation.`,
      silent,
    );
  } else if (data.snapshot.phase === "paused_declined") {
    warn(
      `${data.snapshot.poolAccountId ?? "This workflow"} was declined by the ASP. This saved workflow is paused on the public recovery path.`,
      silent,
    );
  } else if (data.snapshot.phase === "paused_poi_required") {
    warn(
      `${data.snapshot.poolAccountId} needs Proof of Association before the private withdrawal can continue.`,
      silent,
    );
  } else if (data.snapshot.phase === "stopped_external") {
    warn(
      `${data.snapshot.poolAccountId} changed outside this saved workflow, so the easy path stopped without taking further action.`,
      silent,
    );
  } else if (data.action === "start") {
    if (data.snapshot.phase === "awaiting_funding" && data.snapshot.walletAddress) {
      success(
        `Workflow ${data.snapshot.workflowId} started with a dedicated wallet at ${data.snapshot.walletAddress}.`,
        silent,
      );
    } else {
      success(
        `Flow started for ${data.snapshot.poolAccountId}. The deposit is public now; the private withdrawal will run after ASP approval.`,
        silent,
      );
    }
  } else if (data.action === "ragequit") {
    success(
      `Workflow ${data.snapshot.workflowId} recovered funds publicly from ${data.snapshot.poolAccountId}.`,
      silent,
    );
  } else {
    info(
      `Workflow ${data.snapshot.workflowId} is ${phaseLabel(data.snapshot.phase).toLowerCase()}.`,
      silent,
    );
  }

  info(`Workflow: ${data.snapshot.workflowId}`, silent);
  info(`Phase: ${phaseLabel(data.snapshot.phase)}`, silent);
  info(`Wallet mode: ${data.snapshot.walletMode ?? "configured"}`, silent);
  if (data.snapshot.walletAddress) {
    info(
      `${
        data.snapshot.walletMode === "new_wallet"
          ? "Workflow wallet"
          : "Configured signer"
      }: ${data.snapshot.walletAddress}`,
      silent,
    );
  }
  info(`Chain: ${data.snapshot.chain}`, silent);
  info(`Asset: ${data.snapshot.asset}`, silent);
  info(`Recipient: ${data.snapshot.recipient}`, silent);
  if (data.snapshot.poolAccountId) {
    info(`Pool Account: ${data.snapshot.poolAccountId}`, silent);
  }
  const depositAmount = formatFlowAssetAmount(
    data.snapshot.depositAmount,
    data.snapshot,
  );
  if (depositAmount) {
    info(`Deposit amount: ${depositAmount}`, silent);
  }
  const requiredTokenFunding = formatFlowAssetAmount(
    data.snapshot.requiredTokenFunding,
    data.snapshot,
  );
  if (requiredTokenFunding) {
    info(`Required token funding: ${requiredTokenFunding}`, silent);
  }
  const requiredNativeFunding = formatFlowNativeFunding(
    data.snapshot.requiredNativeFunding,
  );
  if (requiredNativeFunding) {
    info(`Required native funding: ${requiredNativeFunding}`, silent);
  }
  info(`Backup confirmed: ${data.snapshot.backupConfirmed ? "yes" : "no"}`, silent);
  const committedValue = formatFlowAssetAmount(
    data.snapshot.committedValue,
    data.snapshot,
  );
  if (committedValue) {
    info(`Committed value: ${committedValue}`, silent);
  }
  if (data.snapshot.depositTxHash) {
    info(`Deposit tx: ${data.snapshot.depositTxHash}`, silent);
  }
  if (data.snapshot.depositExplorerUrl) {
    info(`Deposit explorer: ${data.snapshot.depositExplorerUrl}`, silent);
  }
  if (data.snapshot.withdrawTxHash) {
    info(`Withdraw tx: ${data.snapshot.withdrawTxHash}`, silent);
  }
  if (data.snapshot.withdrawExplorerUrl) {
    info(`Withdraw explorer: ${data.snapshot.withdrawExplorerUrl}`, silent);
  }
  if (data.snapshot.ragequitTxHash) {
    info(`Ragequit tx: ${data.snapshot.ragequitTxHash}`, silent);
  }
  if (data.snapshot.ragequitExplorerUrl) {
    info(`Ragequit explorer: ${data.snapshot.ragequitExplorerUrl}`, silent);
  }
  if (data.snapshot.phase === "paused_poi_required") {
    info(
      `Complete Proof of Association at ${POA_PORTAL_URL}, then re-run this workflow watcher.`,
      silent,
    );
  }
  if (
    data.snapshot.walletMode === "new_wallet" &&
    (data.snapshot.phase === "completed" ||
      data.snapshot.phase === "completed_public_recovery" ||
      data.snapshot.phase === "paused_declined" ||
      data.snapshot.phase === "paused_poi_required" ||
      data.snapshot.phase === "stopped_external")
  ) {
    warn(
      "Any leftover funds or gas reserve remain in the dedicated workflow wallet until you move them manually.",
      silent,
    );
  }
  if (data.snapshot.lastError) {
    warn(
      `Last error (${data.snapshot.lastError.step}): ${data.snapshot.lastError.errorMessage}`,
      silent,
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
