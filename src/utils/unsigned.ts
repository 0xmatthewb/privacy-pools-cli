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
    pi_a: BigNumberish[];
    pi_b: BigNumberish[][];
    pi_c: BigNumberish[];
  };
  publicSignals: BigNumberish[];
}

export interface SolidityProof {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  pubSignals: bigint[];
}

export interface SolidityWithdrawProof extends Omit<SolidityProof, "pubSignals"> {
  pubSignals: [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
}

export interface SolidityRagequitProof extends Omit<SolidityProof, "pubSignals"> {
  pubSignals: [bigint, bigint, bigint, bigint];
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
    from: tx.from,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    valueHex: toHexQuantity(tx.value),
    chainId: tx.chainId,
    description: tx.description,
  }));

  // Always emit as array for consistent agent parsing
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function toSolidityProof(raw: Groth16Like): SolidityProof {
  // Validate container shape before accessing nested properties.
  const proof = (raw as unknown as Record<string, unknown>)?.proof;
  if (
    typeof proof !== "object" ||
    proof === null ||
    !Array.isArray((proof as Record<string, unknown>).pi_a) ||
    !Array.isArray((proof as Record<string, unknown>).pi_b) ||
    !Array.isArray((proof as Record<string, unknown>).pi_c)
  ) {
    throw new CLIError(
      "Malformed proof structure: expected proof with pi_a, pi_b, and pi_c arrays.",
      "PROOF",
      "Regenerate the proof and retry.",
      "PROOF_MALFORMED"
    );
  }

  const { pi_a, pi_b, pi_c } = proof as {
    pi_a: unknown[];
    pi_b: unknown[];
    pi_c: unknown[];
  };

  if (pi_a.length < 2) {
    throw new CLIError(
      "Malformed proof structure: pi_a requires at least 2 elements.",
      "PROOF",
      "Regenerate the proof and retry.",
      "PROOF_MALFORMED"
    );
  }

  if (
    pi_b.length < 2 ||
    !Array.isArray(pi_b[0]) || (pi_b[0] as unknown[]).length < 2 ||
    !Array.isArray(pi_b[1]) || (pi_b[1] as unknown[]).length < 2
  ) {
    throw new CLIError(
      "Malformed proof structure: pi_b requires at least 2 pairs of 2 elements.",
      "PROOF",
      "Regenerate the proof and retry.",
      "PROOF_MALFORMED"
    );
  }

  if (pi_c.length < 2) {
    throw new CLIError(
      "Malformed proof structure: pi_c requires at least 2 elements.",
      "PROOF",
      "Regenerate the proof and retry.",
      "PROOF_MALFORMED"
    );
  }

  const pubSignals = (raw as unknown as Record<string, unknown>)?.publicSignals;
  if (!Array.isArray(pubSignals)) {
    throw new CLIError(
      "Malformed proof structure: expected publicSignals array.",
      "PROOF",
      "Regenerate the proof and retry.",
      "PROOF_MALFORMED"
    );
  }

  return {
    pA: [
      toBigIntValue(pi_a[0] as BigNumberish, "proof.pi_a[0]"),
      toBigIntValue(pi_a[1] as BigNumberish, "proof.pi_a[1]"),
    ],
    // Solidity verifier layout expects each pair reversed.
    pB: [
      [
        toBigIntValue((pi_b[0] as BigNumberish[])[1], "proof.pi_b[0][1]"),
        toBigIntValue((pi_b[0] as BigNumberish[])[0], "proof.pi_b[0][0]"),
      ],
      [
        toBigIntValue((pi_b[1] as BigNumberish[])[1], "proof.pi_b[1][1]"),
        toBigIntValue((pi_b[1] as BigNumberish[])[0], "proof.pi_b[1][0]"),
      ],
    ],
    pC: [
      toBigIntValue(pi_c[0] as BigNumberish, "proof.pi_c[0]"),
      toBigIntValue(pi_c[1] as BigNumberish, "proof.pi_c[1]"),
    ],
    pubSignals: pubSignals.map((value: unknown, idx: number) =>
      toBigIntValue(value as BigNumberish, `publicSignals[${idx}]`)
    ),
  };
}

function requirePublicSignals(
  proof: SolidityProof,
  expectedLength: number,
  label: string,
): bigint[] {
  if (proof.pubSignals.length !== expectedLength) {
    throw new CLIError(
      `Malformed proof structure: expected ${expectedLength} public signals for ${label}.`,
      "PROOF",
      "Regenerate the proof and retry.",
      "PROOF_MALFORMED"
    );
  }

  return proof.pubSignals;
}

export function toWithdrawSolidityProof(
  raw: Groth16Like,
): SolidityWithdrawProof {
  const proof = toSolidityProof(raw);
  const pubSignals = requirePublicSignals(proof, 8, "withdraw");

  return {
    ...proof,
    pubSignals: [
      pubSignals[0],
      pubSignals[1],
      pubSignals[2],
      pubSignals[3],
      pubSignals[4],
      pubSignals[5],
      pubSignals[6],
      pubSignals[7],
    ],
  };
}

export function toRagequitSolidityProof(
  raw: Groth16Like,
): SolidityRagequitProof {
  const proof = toSolidityProof(raw);
  const pubSignals = requirePublicSignals(proof, 4, "ragequit");

  return {
    ...proof,
    pubSignals: [
      pubSignals[0],
      pubSignals[1],
      pubSignals[2],
      pubSignals[3],
    ],
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
