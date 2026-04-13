import { isAddress, parseUnits } from "viem";
import { CHAINS, CHAIN_NAMES, resolveChainOverrides } from "../config/chains.js";
import type { ChainConfig } from "../types.js";
import { CLIError } from "./errors.js";
import { didYouMean } from "./fuzzy.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function resolveChain(
  chainName?: string,
  defaultChain?: string
): ChainConfig {
  const name = chainName ?? defaultChain ?? "mainnet";

  const normalized = name.toLowerCase();
  const resolvedName = normalized === "ethereum" ? "mainnet" : normalized;
  const config = CHAINS[resolvedName];
  if (!config) {
    const suggestion = didYouMean(name, CHAIN_NAMES);
    const hint = suggestion
      ? `Did you mean "${suggestion}"? Available chains: ${CHAIN_NAMES.join(", ")}`
      : `Available chains: ${CHAIN_NAMES.join(", ")}`;
    throw new CLIError(
      `Unknown chain: ${name}`,
      "INPUT",
      hint
    );
  }

  return resolveChainOverrides(config);
}

export function validateAddress(
  value: string,
  label: string = "Address",
): `0x${string}` {
  if (!isAddress(value)) {
    throw new CLIError(
      `${label} is not a valid Ethereum address: ${value}`,
      "INPUT",
      "Provide a 0x-prefixed, 42-character hex address (e.g. 0xAbC...123)."
    );
  }

  if (value.toLowerCase() === ZERO_ADDRESS) {
    throw new CLIError(
      `${label} cannot be the zero address.`,
      "INPUT",
      "Provide a non-zero destination address. Using 0x000...000 would burn funds.",
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
      "INPUT",
      "Enter a positive number (e.g. 0.1, 10)."
    );
  }
}
