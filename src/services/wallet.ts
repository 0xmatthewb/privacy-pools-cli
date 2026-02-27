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
