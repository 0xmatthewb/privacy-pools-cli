import { isAddress, parseUnits } from "viem";
import { CHAINS, CHAIN_NAMES } from "../config/chains.js";
import type { ChainConfig } from "../types.js";
import { CLIError } from "./errors.js";

function normalizedChainEnvSuffix(chainName: string): string {
  return chainName.replace(/[^a-z0-9]/gi, "_").toUpperCase();
}

function resolveChainHostOverride(
  type: "ASP_HOST" | "RELAYER_HOST",
  chainName: string
): string | undefined {
  const chainSuffix = normalizedChainEnvSuffix(chainName);
  const chainScoped =
    process.env[`PRIVACY_POOLS_${type}_${chainSuffix}`]?.trim() ||
    process.env[`PP_${type}_${chainSuffix}`]?.trim();
  if (chainScoped) return chainScoped;

  const global =
    process.env[`PRIVACY_POOLS_${type}`]?.trim() ||
    process.env[`PP_${type}`]?.trim();
  return global || undefined;
}

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

  const aspHostOverride = resolveChainHostOverride("ASP_HOST", normalized);
  const relayerHostOverride = resolveChainHostOverride(
    "RELAYER_HOST",
    normalized
  );

  if (!aspHostOverride && !relayerHostOverride) {
    return config;
  }

  return {
    ...config,
    aspHost: aspHostOverride ?? config.aspHost,
    relayerHost: relayerHostOverride ?? config.relayerHost,
  };
}

export function validateAddress(value: string, label: string = "Address"): `0x${string}` {
  if (!isAddress(value)) {
    throw new CLIError(
      `${label} is not a valid Ethereum address: ${value}`,
      "INPUT",
      "Provide a 0x-prefixed, 42-character hex address (e.g. 0xAbC...123)."
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
