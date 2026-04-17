import { readFile } from "node:fs/promises";
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

export const WITHDRAW_CIRCUIT_MAX_TREE_DEPTH = 32n;

type SnarkjsWitnessHandle = {
  type: "mem";
};

type SnarkjsLogger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type Groth16VerificationKey = Parameters<typeof snarkjs.groth16.verify>[0];

const groth16VerificationKeyCache = new Map<
  string,
  Promise<Groth16VerificationKey>
>();

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

function createLocalProofVerificationError(
  circuit: CircuitName,
  error?: unknown,
): CLIError {
  const circuitLabel = circuit === "commitment" ? "commitment" : "withdrawal";
  const hint = error === undefined
    ? "Regenerate the proof after running 'privacy-pools sync'. If this persists, reinstall the CLI to refresh the bundled circuit artifacts."
    : sanitizeDiagnosticText(
        error instanceof Error ? error.message : String(error),
      );

  return new CLIError(
    `Generated ${circuitLabel} proof failed local verification.`,
    "PROOF",
    hint,
    "PROOF_VERIFICATION_FAILED",
    false,
    undefined,
    undefined,
    "guide/troubleshooting",
  );
}

async function loadGroth16VerificationKey(
  vkeyPath: string,
): Promise<Groth16VerificationKey> {
  const cached = groth16VerificationKeyCache.get(vkeyPath);
  if (cached) {
    return cached;
  }

  const loadPromise = readFile(vkeyPath, "utf8")
    .then((raw) => JSON.parse(raw) as Groth16VerificationKey)
    .catch((error) => {
      groth16VerificationKeyCache.delete(vkeyPath);
      throw error;
    });
  groth16VerificationKeyCache.set(vkeyPath, loadPromise);
  return loadPromise;
}

async function verifyGroth16Proof(
  circuit: CircuitName,
  verificationKeyPromise: Promise<Groth16VerificationKey>,
  proof: unknown,
  publicSignals: unknown,
  options?: ProofOptions,
): Promise<void> {
  options?.progress?.markVerifyProofPhase();

  let verified = false;
  try {
    verified = await snarkjs.groth16.verify(
      await verificationKeyPromise,
      publicSignals as Parameters<typeof snarkjs.groth16.verify>[1],
      proof as Parameters<typeof snarkjs.groth16.verify>[2],
    );
  } catch (error) {
    throw createLocalProofVerificationError(circuit, error);
  }

  if (!verified) {
    throw createLocalProofVerificationError(circuit);
  }
}

async function runGroth16Proof(
  inputs: Record<string, bigint | bigint[] | string>,
  circuit: CircuitName,
  options?: ProofOptions,
): Promise<{ proof: unknown; publicSignals: unknown }> {
  try {
    options?.progress?.markArtifactVerificationPhase();
    const { wasm, zkey, vkey } = await getCircuitArtifactPaths(circuit);
    const verificationKeyPromise = loadGroth16VerificationKey(vkey);

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
    await verifyGroth16Proof(
      circuit,
      verificationKeyPromise,
      result.proof,
      result.publicSignals,
      options,
    );
    return result as { proof: unknown; publicSignals: unknown };
  } finally {
    await cleanupSnarkjsCurveCaches();
  }
}

async function cleanupSnarkjsCurveCaches(): Promise<void> {
  const curveCacheKeys: SnarkjsCurveCacheKey[] = [
    "curve_bn128",
    "curve_bls12381",
  ];
  const globalCurves = globalThis as typeof globalThis & {
    curve_bn128?: TerminableSnarkjsCurve | null;
    curve_bls12381?: TerminableSnarkjsCurve | null;
  };
  const cleanupTasks: Promise<void>[] = [];

  for (const key of curveCacheKeys) {
    const curve = globalCurves[key];
    if (!curve?.terminate) continue;

    cleanupTasks.push(
      Promise.resolve(curve.terminate()).catch(() => {
        // Best effort only. Proof generation already completed or failed with a
        // more relevant error, and cleanup should not replace that outcome.
      }),
    );
    globalCurves[key] = null;
  }

  await Promise.all(cleanupTasks);
}

export async function resetSnarkjsCurveCachesForTests(): Promise<void> {
  await cleanupSnarkjsCurveCaches();
}

export function resetGroth16VerificationKeyCacheForTests(): void {
  groth16VerificationKeyCache.clear();
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
      "PROOF_GENERATION_FAILED",
      false,
      undefined,
      undefined,
      "guide/troubleshooting",
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

function deriveTreeDepthFromSiblings(
  siblings: readonly bigint[],
  label: "state" | "ASP",
): bigint {
  const depth = BigInt(siblings.length);
  if (depth > WITHDRAW_CIRCUIT_MAX_TREE_DEPTH) {
    throw new CLIError(
      `Cannot build a withdrawal proof with ${label} tree depth ${depth}.`,
      "PROOF",
      `The bundled circuit supports up to ${WITHDRAW_CIRCUIT_MAX_TREE_DEPTH} levels.`,
      "PROOF_GENERATION_FAILED",
      false,
      undefined,
      undefined,
      "guide/troubleshooting",
    );
  }
  return depth;
}

export function deriveWithdrawalTreeDepths(input: Pick<
  WithdrawalProofInput,
  "stateMerkleProof" | "aspMerkleProof"
>): Pick<WithdrawalProofInput, "stateTreeDepth" | "aspTreeDepth"> {
  return {
    stateTreeDepth: deriveTreeDepthFromSiblings(
      input.stateMerkleProof.siblings,
      "state",
    ),
    aspTreeDepth: deriveTreeDepthFromSiblings(
      input.aspMerkleProof.siblings,
      "ASP",
    ),
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
      "PROOF_GENERATION_FAILED",
      false,
      undefined,
      undefined,
      "guide/troubleshooting",
    );
  }
}
