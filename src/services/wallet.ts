import { generateMasterKeys } from "@0xbow/privacy-pools-core-sdk";
import {
  english,
  generateMnemonic as viemGenerateMnemonic,
  privateKeyToAccount,
} from "viem/accounts";
import { validateMnemonic as bip39ValidateMnemonic } from "@scure/bip39";
import { wordlist as bip39EnglishWordlist } from "@scure/bip39/wordlists/english";
import { loadMnemonicFromFile, loadSignerKey } from "./config.js";
import { CLIError } from "../utils/errors.js";
import type { Address } from "viem";

export function generateMnemonic(): string {
  return viemGenerateMnemonic(english);
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39ValidateMnemonic(mnemonic.trim(), bip39EnglishWordlist);
}

/**
 * Extract a BIP-39 mnemonic from file content that may contain headers,
 * labels, and warnings (e.g. CLI backup files or website recovery downloads).
 *
 * Strategy:
 *   1. Try the entire trimmed content as a mnemonic (handles raw-only files).
 *   2. Scan line-by-line for exactly one valid mnemonic line.
 *   3. Return null if zero or multiple mnemonic lines are found.
 */
export function extractMnemonicFromFile(content: string): string | null {
  const trimmed = content.trim();

  // Fast path: entire content is a raw mnemonic
  if (validateMnemonic(trimmed)) {
    return trimmed;
  }

  // Slow path: scan each line for a valid mnemonic
  const lines = trimmed.split(/\r?\n/);
  let found: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    // Skip empty lines and lines that are clearly not mnemonics:
    // fewer than 12 space-separated tokens can't be a valid BIP-39 phrase
    if (!line || line.split(/\s+/).length < 12) continue;
    if (validateMnemonic(line)) {
      // If we already found one, the file is ambiguous — fail safely
      if (found !== null) return null;
      found = line;
    }
  }

  return found;
}

export function getMasterKeys(mnemonic: string) {
  return generateMasterKeys(mnemonic);
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
      "Re-initialize with: privacy-pools init --mnemonic '<your phrase>'"
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
