import { isAddress, parseUnits } from "viem";
import { CHAINS, CHAIN_NAMES } from "../config/chains.js";
import type { ChainConfig } from "../types.js";
import { CLIError } from "./errors.js";

export function resolveChain(
  chainName?: string,
  defaultChain?: string
): ChainConfig {
  const name = chainName ?? defaultChain;
  if (!name) {
    throw new CLIError(
      "No chain specified. Use --chain or set a default chain with 'privacy-pools init'.",
      "INPUT",
      `Available chains: ${CHAIN_NAMES.join(", ")}`
    );
  }

  const normalized = name.toLowerCase();
  const config = CHAINS[normalized];
  if (!config) {
    throw new CLIError(
      `Unknown chain: ${name}`,
      "INPUT",
      `Available chains: ${CHAIN_NAMES.join(", ")}`
    );
  }

  return config;
}

export function validateAddress(value: string, label: string = "Address"): `0x${string}` {
  if (!isAddress(value)) {
    throw new CLIError(
      `${label} is not a valid Ethereum address: ${value}`,
      "INPUT"
    );
  }
  return value as `0x${string}`;
}

export function parseAmount(
  value: string,
  decimals: number
): bigint {
  const trimmed = value.trim();
  if (!/^\d*\.?\d+$/.test(trimmed)) {
    throw new CLIError(
      `Invalid amount: ${value}`,
      "INPUT",
      "Amount must be a valid non-negative number (e.g., 0.1, 10, 1000.50)"
    );
  }

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    throw new CLIError(
      `Invalid amount precision: ${value}`,
      "INPUT",
      `Amount supports up to ${decimals} decimal places for this asset.`
    );
  }

  try {
    return parseUnits(trimmed, decimals);
  } catch {
    throw new CLIError(
      `Invalid amount: ${value}`,
      "INPUT",
      "Amount must be a valid non-negative number (e.g., 0.1, 10, 1000.50)"
    );
  }
}

export function validatePositive(value: bigint, label: string = "Amount"): void {
  if (value <= 0n) {
    throw new CLIError(
      `${label} must be greater than zero.`,
      "INPUT"
    );
  }
}
