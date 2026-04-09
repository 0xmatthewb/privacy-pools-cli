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
import type { ProofProgressController } from "../utils/proof-progress.js";

type SnarkjsCurveCacheKey = "curve_bn128" | "curve_bls12381";

interface TerminableSnarkjsCurve {
  terminate?: () => Promise<void> | void;
}

type CircuitName = "commitment" | "withdraw";

type ProofOptions = {
  progress?: ProofProgressController;
};

type SnarkjsWitnessHandle = {
  type: "mem";
};

type SnarkjsLogger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

function shouldAdvanceToFinalizeProof(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("reading c points") ||
    normalized.includes("reading h points") ||
    normalized.includes("multiexp c") ||
    normalized.includes("multiexp h")
  );
}

function createProofLogger(
  onFinalizePhase: () => void,
): SnarkjsLogger {
  const maybeMarkFinalizePhase = (message: string) => {
    if (!shouldAdvanceToFinalizeProof(message)) return;
    onFinalizePhase();
  };

  return {
    debug(message: string) {
      maybeMarkFinalizePhase(message);
    },
    info(message: string) {
      maybeMarkFinalizePhase(message);
    },
    warn() {},
    error() {},
  };
}

async function runGroth16Proof(
  inputs: Record<string, bigint | bigint[] | string>,
  circuit: CircuitName,
  options?: ProofOptions,
): Promise<{ proof: unknown; publicSignals: unknown }> {
  options?.progress?.markVerificationPhase();
  const { wasm, zkey } = await getCircuitArtifactPaths(circuit);

  options?.progress?.markBuildWitnessPhase();
  const witness: SnarkjsWitnessHandle = { type: "mem" };
  await snarkjs.wtns.calculate(inputs, wasm, witness);

  options?.progress?.markGenerateProofPhase();
  let finalizePhaseShown = false;
  const markFinalizePhase = () => {
    if (finalizePhaseShown) return;
    finalizePhaseShown = true;
    options?.progress?.markFinalizeProofPhase();
  };
  const result = await snarkjs.groth16.prove(
    zkey,
    witness as unknown as Parameters<typeof snarkjs.groth16.prove>[1],
    createProofLogger(markFinalizePhase),
  );
  markFinalizePhase();
  return result as { proof: unknown; publicSignals: unknown };
}

async function cleanupSnarkjsCurveCaches(): Promise<void> {
  const curveCacheKeys: SnarkjsCurveCacheKey[] = [
    "curve_bn128",
    "curve_bls12381",
  ];
  const cleanupTasks: Promise<void>[] = [];

  for (const key of curveCacheKeys) {
    const curve = (globalThis as typeof globalThis & {
      curve_bn128?: TerminableSnarkjsCurve | null;
      curve_bls12381?: TerminableSnarkjsCurve | null;
    })[key];
    if (!curve?.terminate) continue;

    cleanupTasks.push(
      Promise.resolve(curve.terminate()).catch(() => {
        // Best effort only. Proof generation already completed or failed with a
        // more relevant error, and cleanup should not replace that outcome.
      }),
    );
  }

  await Promise.all(cleanupTasks);
}

export async function proveCommitment(
  value: bigint,
  label: bigint,
  nullifier: bigint,
  secret: bigint,
  options?: ProofOptions,
): Promise<CommitmentProof> {
  try {
    const { proof, publicSignals } = await runGroth16Proof(
      { value, label, nullifier, secret },
      "commitment",
      options,
    );
    return { proof, publicSignals } as CommitmentProof;
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
  } finally {
    await cleanupSnarkjsCurveCaches();
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
  input: WithdrawalProofInput,
  options?: ProofOptions,
): Promise<WithdrawalProof> {
  try {
    const { proof, publicSignals } = await runGroth16Proof(
      prepareWithdrawalInputSignals(commitment, input),
      "withdraw",
      options,
    );
    return { proof, publicSignals } as WithdrawalProof;
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
  } finally {
    await cleanupSnarkjsCurveCaches();
  }
}
