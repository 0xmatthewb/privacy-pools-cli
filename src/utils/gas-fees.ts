import { parseGwei } from "viem";
import { CLIError } from "./errors.js";

export interface GasFeeCliOptions {
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface GasFeeOverrides {
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

function parseGweiOption(name: string, value: string | undefined): bigint | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = parseGwei(trimmed);
    if (parsed <= 0n) {
      throw new Error("non-positive gas price");
    }
    return parsed;
  } catch {
    throw new CLIError(
      `Invalid ${name} value '${value}'.`,
      "INPUT",
      `${name} expects a positive gas price in gwei, for example ${name} 25 or ${name} 1.5.`,
      "INPUT_INVALID_OPTION",
    );
  }
}

export function parseGasFeeOverrides(opts: GasFeeCliOptions): GasFeeOverrides | undefined {
  const gasPrice = parseGweiOption("--gas-price", opts.gasPrice);
  const maxFeePerGas = parseGweiOption("--max-fee-per-gas", opts.maxFeePerGas);
  const maxPriorityFeePerGas = parseGweiOption(
    "--max-priority-fee-per-gas",
    opts.maxPriorityFeePerGas,
  );

  if (gasPrice !== undefined && (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined)) {
    throw new CLIError(
      "--gas-price cannot be combined with EIP-1559 fee flags.",
      "INPUT",
      "Use either --gas-price, or use --max-fee-per-gas with optional --max-priority-fee-per-gas.",
      "INPUT_FLAG_CONFLICT",
    );
  }

  if (maxPriorityFeePerGas !== undefined && maxFeePerGas === undefined) {
    throw new CLIError(
      "--max-priority-fee-per-gas requires --max-fee-per-gas.",
      "INPUT",
      "Pass both EIP-1559 fee caps, for example --max-fee-per-gas 30 --max-priority-fee-per-gas 2.",
      "INPUT_MISSING_ARGUMENT",
    );
  }

  if (
    maxFeePerGas !== undefined &&
    maxPriorityFeePerGas !== undefined &&
    maxPriorityFeePerGas > maxFeePerGas
  ) {
    throw new CLIError(
      "--max-priority-fee-per-gas cannot exceed --max-fee-per-gas.",
      "INPUT",
      "Increase --max-fee-per-gas or lower --max-priority-fee-per-gas.",
      "INPUT_INVALID_OPTION",
    );
  }

  if (gasPrice !== undefined) return { gasPrice };
  if (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined) {
    return {
      ...(maxFeePerGas !== undefined ? { maxFeePerGas } : {}),
      ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
    };
  }
  return undefined;
}
