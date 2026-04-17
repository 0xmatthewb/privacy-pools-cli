import { isAddress, parseUnits } from "viem";
import { CHAINS, CHAIN_NAMES, resolveChainOverrides } from "../config/chains.js";
import type { ChainConfig } from "../types.js";
import { CLIError } from "./errors.js";
import { didYouMean } from "./fuzzy.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function resolveChain(
  chainName?: string,
  defaultChain?: string
): ChainConfig {
  const name = chainName ?? defaultChain ?? "mainnet";

  const normalized = name.toLowerCase().trim();

  // Accept viem canonical names (as shown in the website) alongside CLI short names.
  const CHAIN_ALIASES: Record<string, string> = {
    ethereum: "mainnet",
    "arbitrum one": "arbitrum",
    "op mainnet": "optimism",
    "op sepolia": "op-sepolia",
  };
  const resolvedName = CHAIN_ALIASES[normalized] ?? normalized;
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
    if (!value.startsWith("0x") || value.length !== 42 || !HEX_ADDRESS_PATTERN.test(value)) {
      throw new CLIError(
        `${label} is not a valid Ethereum address: ${value}`,
        "INPUT",
        "Provide a 0x-prefixed, 42-character hex address (e.g. 0xAbC...123)."
      );
    }
    throw new CLIError(
      `${label} is not a valid Ethereum address: ${value}`,
      "INPUT",
      "Provide an address with the correct EIP-55 checksum, or use the all-lowercase / all-uppercase form.",
      "INPUT_ADDRESS_CHECKSUM_INVALID",
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
  decimals: number,
  options: { allowNegative?: boolean } = {},
): bigint {
  const trimmed = value.trim();
  const allowNegative = options.allowNegative === true;
  const amountPattern = allowNegative ? /^-?\d*\.?\d+$/ : /^\d*\.?\d+$/;
  if (!amountPattern.test(trimmed)) {
    throw new CLIError(
      `Invalid amount: ${value}`,
      "INPUT",
      "Amount must be a valid non-negative number (e.g., 0.1, 10, 1000.50)"
    );
  }

  const negative = trimmed.startsWith("-");
  const normalized = negative ? trimmed.slice(1) : trimmed;
  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    throw new CLIError(
      `Invalid amount precision: ${value}`,
      "INPUT",
      `Amount supports up to ${decimals} decimal places for this asset.`
    );
  }

  try {
    const parsed = parseUnits(normalized, decimals);
    return negative ? -parsed : parsed;
  } catch {
    throw new CLIError(
      `Invalid amount: ${value}`,
      "INPUT",
      "Amount must be a valid non-negative number (e.g., 0.1, 10, 1000.50)"
    );
  }
}

export interface ResolvedAddress {
  address: `0x${string}`;
  ensName?: string;
}

/**
 * Resolve an input string to an Ethereum address.
 *
 * If the input is already a valid hex address, returns it directly.
 * If it contains a dot (e.g. `vitalik.eth`), attempts ENS resolution on
 * mainnet.  ENS always resolves on L1 regardless of `--chain`.
 *
 * Uses dynamic imports for viem/ens to keep startup fast.
 */
export async function resolveAddressOrEns(
  input: string,
  label?: string,
): Promise<ResolvedAddress> {
  // Already a valid address — fast path, no dynamic import needed.
  if (isAddress(input)) {
    return { address: validateAddress(input, label) };
  }

  // Try ENS resolution for names containing a dot (e.g. name.eth, name.xyz).
  if (input.includes(".")) {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");
    const { normalize } = await import("viem/ens");

    const client = createPublicClient({
      chain: mainnet,
      transport: http(),
    });

    try {
      const resolved = await client.getEnsAddress({
        name: normalize(input),
      });
      if (resolved) {
        return { address: resolved, ensName: input };
      }
    } catch {
      // Fall through to error
    }

    throw new CLIError(
      `Could not resolve ENS name "${input}".`,
      "INPUT",
      "Verify the name exists and try again. ENS resolution requires mainnet connectivity.",
    );
  }

  // Neither a valid address nor an ENS-like name.
  return { address: validateAddress(input, label) };
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
