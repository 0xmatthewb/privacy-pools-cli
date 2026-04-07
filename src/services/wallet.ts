import { generateMasterKeys } from "@0xbow/privacy-pools-core-sdk";
import {
  english,
  generateMnemonic as viemGenerateMnemonic,
  privateKeyToAccount,
} from "viem/accounts";
import { validateMnemonic as bip39ValidateMnemonic } from "@scure/bip39";
import { wordlist as bip39EnglishWordlist } from "@scure/bip39/wordlists/english.js";
import { loadMnemonicFromFile, loadSignerKey } from "./config.js";
import { CLIError } from "../utils/errors.js";
import { withSuppressedSdkStdoutSync } from "./account.js";
import type { Address } from "viem";

export const GENERATED_MNEMONIC_STRENGTH = 256;
const SUPPORTED_MNEMONIC_WORD_COUNTS = new Set([12, 24]);

function hasSupportedMnemonicWordCount(mnemonic: string): boolean {
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  return SUPPORTED_MNEMONIC_WORD_COUNTS.has(words.length);
}

export function generateMnemonic(): string {
  return viemGenerateMnemonic(english, GENERATED_MNEMONIC_STRENGTH);
}

export function validateMnemonic(mnemonic: string): boolean {
  const trimmed = mnemonic.trim();
  if (!trimmed || !hasSupportedMnemonicWordCount(trimmed)) {
    return false;
  }
  return bip39ValidateMnemonic(trimmed, bip39EnglishWordlist);
}

export type MnemonicExtractionFailure = "none_found" | "multiple_found";

export interface MnemonicExtractionResult {
  mnemonic: string | null;
  failure: MnemonicExtractionFailure | null;
}

/**
 * Extract a BIP-39 mnemonic from file content that may contain headers,
 * labels, and warnings (e.g. CLI backup files or website recovery downloads).
 *
 * Strategy:
 *   1. Try the entire trimmed content as a mnemonic (handles raw-only files).
 *   2. Scan line-by-line for exactly one valid mnemonic line.
 *   3. Return a precise failure reason when zero or multiple lines are found.
 */
export function extractMnemonicFromFileDetailed(
  content: string
): MnemonicExtractionResult {
  const trimmed = content.trim();

  // Fast path: entire content is a raw mnemonic
  if (validateMnemonic(trimmed)) {
    return { mnemonic: trimmed, failure: null };
  }

  // Slow path: scan each line for a valid mnemonic
  const lines = trimmed.split(/\r?\n/);
  let found: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !hasSupportedMnemonicWordCount(line)) continue;
    if (validateMnemonic(line)) {
      // If we already found one, the file is ambiguous — fail safely
      if (found !== null) return { mnemonic: null, failure: "multiple_found" };
      found = line;
    }
  }

  if (!found) {
    return { mnemonic: null, failure: "none_found" };
  }
  return { mnemonic: found, failure: null };
}

export function extractMnemonicFromFile(content: string): string | null {
  return extractMnemonicFromFileDetailed(content).mnemonic;
}

export function getMasterKeys(mnemonic: string) {
  return withSuppressedSdkStdoutSync(() => generateMasterKeys(mnemonic));
}

export function getSignerAddress(privateKey: `0x${string}`): Address {
  return privateKeyToAccount(privateKey).address;
}

export function loadMnemonic(): string {
  const mnemonic = loadMnemonicFromFile();
  if (!mnemonic) {
    throw new CLIError(
      "No recovery phrase found. Run 'privacy-pools init' first.",
      "INPUT",
      "Initialize your wallet with: privacy-pools init"
    );
  }
  if (!validateMnemonic(mnemonic)) {
    throw new CLIError(
      "Stored recovery phrase is invalid or corrupted.",
      "INPUT",
      "Re-initialize with: privacy-pools init --recovery-phrase '<your phrase>'"
    );
  }
  return mnemonic;
}

export function loadPrivateKey(): `0x${string}` {
  const key = loadSignerKey();
  if (!key) {
    throw new CLIError(
      "No signer key found. Run 'privacy-pools init' or set PRIVACY_POOLS_PRIVATE_KEY.",
      "INPUT",
      "Set via env: export PRIVACY_POOLS_PRIVATE_KEY=0x..."
    );
  }

  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new CLIError(
      "Invalid private key format.",
      "INPUT",
      "Private key must be a 64-character hex string (with or without 0x prefix)."
    );
  }

  return normalized as `0x${string}`;
}
