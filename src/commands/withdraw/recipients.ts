import type { Address } from "viem";
import {
  loadKnownRecipientHistory,
  rememberKnownRecipient,
} from "../../services/recipient-history.js";
import {
  getWorkflowStatus,
  listSavedWorkflowIds,
} from "../../services/workflow.js";
import {
  assertSafeRecipientAddress,
  isKnownRecipient,
  newRecipientWarning,
  type RecipientSafetyWarning,
} from "../../utils/recipient-safety.js";
import { promptCancelledError } from "../../utils/errors.js";
import {
  CONFIRMATION_TOKENS,
  confirmActionWithSeverity,
  confirmPrompt,
} from "../../utils/prompts.js";
import { ensurePromptInteractionAvailable } from "../../utils/prompt-cancellation.js";

export function validateRecipientAddressOrEnsInput(value: string): true | string {
  const trimmed = value.trim();
  try {
    assertSafeRecipientAddress(trimmed as `0x${string}`, "Recipient");
    return true;
  } catch (error) {
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(trimmed)) {
      return true;
    }
    return error instanceof Error ? error.message : "Invalid address or ENS name.";
  }
}

export async function confirmRecipientIfNew(params: {
  address: string;
  knownRecipients: readonly string[];
  skipPrompts: boolean;
  silent: boolean;
}): Promise<RecipientSafetyWarning[]> {
  if (isKnownRecipient(params.address, params.knownRecipients)) {
    return [];
  }

  const warning = newRecipientWarning(params.address);
  if (params.skipPrompts) {
    return [warning];
  }

  ensurePromptInteractionAvailable();
  const ok = await confirmActionWithSeverity({
    severity: "standard",
    standardMessage: "Use this new recipient?",
    highStakesToken: CONFIRMATION_TOKENS.recipient,
    highStakesWarning: "Recipient review changed while waiting for confirmation.",
    confirm: confirmPrompt,
  });
  if (!ok) {
    throw promptCancelledError();
  }
  return [];
}

export function collectKnownWorkflowRecipients(): string[] {
  const recipients: string[] = [];
  for (const workflowId of listSavedWorkflowIds()) {
    try {
      const snapshot = getWorkflowStatus({ workflowId });
      if (snapshot.recipient) recipients.push(snapshot.recipient);
      if (snapshot.walletAddress) recipients.push(snapshot.walletAddress);
    } catch {
      // Ignore unreadable workflow files during transaction preflight. The
      // dedicated flow commands report workflow state strictly when requested.
    }
  }
  return recipients;
}

export function collectKnownWithdrawalRecipients(
  signerAddress: Address | null,
): string[] {
  return [
    ...(signerAddress ? [signerAddress] : []),
    ...loadKnownRecipientHistory(),
    ...collectKnownWorkflowRecipients(),
  ];
}

export function rememberSuccessfulWithdrawalRecipient(address: string): void {
  try {
    rememberKnownRecipient(address);
  } catch {
    // Best effort only. The withdrawal result should not fail because the
    // advisory recipient-history cache could not be updated.
  }
}
