import type { Address, Hex } from "viem";
import { CLIError } from "./errors.js";

type BigNumberish = bigint | number | string;

function toBigIntValue(value: BigNumberish, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new CLIError(
      `Malformed proof field: ${label}.`,
      "PROOF",
      "Regenerate the proof and retry.",
      "PROOF_MALFORMED"
    );
  }
}

interface Groth16Like {
  proof: {
    pi_a: [BigNumberish, BigNumberish, ...BigNumberish[]];
    pi_b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish], ...Array<[BigNumberish, BigNumberish]>];
    pi_c: [BigNumberish, BigNumberish, ...BigNumberish[]];
  };
  publicSignals: BigNumberish[];
}

export interface SolidityProof {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  pubSignals: bigint[];
}

export interface UnsignedTransactionPayload {
  chainId: number;
  from: Address | null;
  to: Address;
  value: string;
  data: Hex;
  description: string;
}

export function printRawTransactions(
  transactions: UnsignedTransactionPayload[]
): void {
  const toHexQuantity = (value: string): string => {
    const asBigInt = BigInt(value);
    return `0x${asBigInt.toString(16)}`;
  };

  const payload = transactions.map((tx) => ({
    to: tx.to,
    data: tx.data,
    value: tx.value,
    valueHex: toHexQuantity(tx.value),
    chainId: tx.chainId,
  }));

  console.log(JSON.stringify(payload.length === 1 ? payload[0] : payload));
}

export function toSolidityProof(raw: Groth16Like): SolidityProof {
  return {
    pA: [
      toBigIntValue(raw.proof.pi_a[0], "proof.pi_a[0]"),
      toBigIntValue(raw.proof.pi_a[1], "proof.pi_a[1]"),
    ],
    // Solidity verifier layout expects each pair reversed.
    pB: [
      [
        toBigIntValue(raw.proof.pi_b[0][1], "proof.pi_b[0][1]"),
        toBigIntValue(raw.proof.pi_b[0][0], "proof.pi_b[0][0]"),
      ],
      [
        toBigIntValue(raw.proof.pi_b[1][1], "proof.pi_b[1][1]"),
        toBigIntValue(raw.proof.pi_b[1][0], "proof.pi_b[1][0]"),
      ],
    ],
    pC: [
      toBigIntValue(raw.proof.pi_c[0], "proof.pi_c[0]"),
      toBigIntValue(raw.proof.pi_c[1], "proof.pi_c[1]"),
    ],
    pubSignals: raw.publicSignals.map((value, idx) =>
      toBigIntValue(value, `publicSignals[${idx}]`)
    ),
  };
}

export function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyBigInts(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [key, stringifyBigInts(item)]
    );
    return Object.fromEntries(entries);
  }
  return value;
}
