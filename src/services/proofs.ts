import * as snarkjs from "snarkjs";
import type {
  AccountCommitment,
  Commitment,
  CommitmentProof,
  WithdrawalProof,
  WithdrawalProofInput,
} from "@0xbow/privacy-pools-core-sdk";
import { getCircuitArtifactPaths } from "./circuits.js";
import { CLIError, sanitizeDiagnosticText } from "../utils/errors.js";
const SINGLE_THREAD_PROVER_OPTIONS = { singleThread: true } as const;

export async function proveCommitment(
  value: bigint,
  label: bigint,
  nullifier: bigint,
  secret: bigint
): Promise<CommitmentProof> {
  try {
    const { wasm, zkey } = await getCircuitArtifactPaths("commitment");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { value, label, nullifier, secret },
      wasm,
      zkey,
      undefined,
      undefined,
      SINGLE_THREAD_PROVER_OPTIONS
    );
    return { proof, publicSignals };
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      "Failed to generate commitment proof.",
      "PROOF",
      sanitizeDiagnosticText(
        error instanceof Error ? error.message : String(error),
      ),
      "PROOF_GENERATION_FAILED"
    );
  }
}

function prepareWithdrawalInputSignals(
  commitment: Commitment | AccountCommitment,
  input: WithdrawalProofInput
): Record<string, bigint | bigint[] | string> {
  let existingValue: bigint;
  let existingNullifier: bigint;
  let existingSecret: bigint;
  let label: bigint;

  if ("preimage" in commitment) {
    existingValue = commitment.preimage.value;
    existingNullifier = commitment.preimage.precommitment.nullifier;
    existingSecret = commitment.preimage.precommitment.secret;
    label = commitment.preimage.label;
  } else {
    existingValue = commitment.value;
    existingNullifier = commitment.nullifier;
    existingSecret = commitment.secret;
    label = commitment.label;
  }

  return {
    withdrawnValue: input.withdrawalAmount,
    stateRoot: input.stateRoot,
    stateTreeDepth: input.stateTreeDepth,
    ASPRoot: input.aspRoot,
    ASPTreeDepth: input.aspTreeDepth,
    context: input.context,
    label,
    existingValue,
    existingNullifier,
    existingSecret,
    newNullifier: input.newNullifier,
    newSecret: input.newSecret,
    stateSiblings: input.stateMerkleProof.siblings,
    stateIndex: BigInt(input.stateMerkleProof.index),
    ASPSiblings: input.aspMerkleProof.siblings,
    ASPIndex: BigInt(input.aspMerkleProof.index),
  };
}

export async function proveWithdrawal(
  commitment: Commitment | AccountCommitment,
  input: WithdrawalProofInput
): Promise<WithdrawalProof> {
  try {
    const { wasm, zkey } = await getCircuitArtifactPaths("withdraw");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      prepareWithdrawalInputSignals(commitment, input),
      wasm,
      zkey,
      undefined,
      undefined,
      SINGLE_THREAD_PROVER_OPTIONS
    );
    return { proof, publicSignals };
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      "Failed to generate withdrawal proof.",
      "PROOF",
      sanitizeDiagnosticText(
        error instanceof Error ? error.message : String(error),
      ),
      "PROOF_GENERATION_FAILED"
    );
  }
}
