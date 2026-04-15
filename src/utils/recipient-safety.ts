import type { Address } from "viem";
import { CLIError } from "./errors.js";
import { resolveAddressOrEns, validateAddress } from "./validation.js";

const BURN_RECIPIENTS = new Set([
  "0x000000000000000000000000000000000000dead",
  "0xdead000000000000000000000000000000000000",
]);

export interface RecipientSafetyWarning {
  code: "recipient_new_to_profile";
  category: "recipient";
  message: string;
}

export function assertSafeRecipientAddress(
  address: Address | `0x${string}`,
  label: string = "Recipient",
): Address {
  const validated = validateAddress(address, label) as Address;
  const normalized = validated.toLowerCase();
  if (BURN_RECIPIENTS.has(normalized)) {
    throw new CLIError(
      `${label} appears to be a burn address.`,
      "INPUT",
      "Provide a recipient you control. Obvious burn or dead-address patterns would make funds unrecoverable.",
    );
  }
  return validated;
}

export async function resolveSafeRecipientAddressOrEns(
  input: string,
  label: string = "Recipient",
): Promise<{ address: Address; ensName?: string }> {
  const resolved = await resolveAddressOrEns(input, label);
  return {
    address: assertSafeRecipientAddress(resolved.address, label),
    ensName: resolved.ensName,
  };
}

export function normalizeRecipientSet(
  candidates: Iterable<string | null | undefined>,
): Set<string> {
  const normalized = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    normalized.add(candidate.toLowerCase());
  }
  return normalized;
}

export function isKnownRecipient(
  address: string,
  knownRecipients: Iterable<string | null | undefined>,
): boolean {
  return normalizeRecipientSet(knownRecipients).has(address.toLowerCase());
}

export function newRecipientWarning(address: string): RecipientSafetyWarning {
  return {
    code: "recipient_new_to_profile",
    category: "recipient",
    message: `Recipient ${address} has not appeared in this local CLI profile before. Double-check the destination before submitting.`,
  };
}
