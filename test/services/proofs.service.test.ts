import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";

let mockFullProveResult = {
  proof: {
    pi_a: ["1", "2", "3"],
    pi_b: [["4", "5"], ["6", "7"], ["8", "9"]],
    pi_c: ["10", "11", "12"],
  },
  publicSignals: ["100", "200", "300"],
};
let witnessCalculateShouldThrow: Error | null = null;
let groth16ProveShouldThrow: Error | null = null;
let artifactsShouldThrow: Error | null = null;
let proofTestsActive = false;

let capturedFullProveInputs: Record<string, unknown> | null = null;
let capturedFullProveWasm: string | null = null;
let capturedFullProveZkey: string | null = null;
let capturedWitnessOutput: { type: "mem" } | null = null;
let capturedGroth16Witness: { type: "mem" } | null = null;
let capturedGroth16Logger: unknown = null;
let capturedGroth16Options: unknown[] | null = null;
const terminateBn128CurveMock = mock(async () => {});
const terminateBls12381CurveMock = mock(async () => {});
const wtnsCalculateMock = mock(
  async (
    inputs: Record<string, unknown>,
    wasm: string,
    witness: { type: "mem" },
  ) => {
    capturedFullProveInputs = inputs;
    capturedFullProveWasm = wasm;
    capturedWitnessOutput = witness;
    if (witnessCalculateShouldThrow) throw witnessCalculateShouldThrow;
  },
);
const groth16ProveMock = mock(
  async (
    zkey: string,
    witness: { type: "mem" },
    logger?: { debug?: (message: string) => void },
    ...options: unknown[]
  ) => {
    capturedFullProveZkey = zkey;
    capturedGroth16Witness = witness;
    capturedGroth16Logger = logger ?? null;
    capturedGroth16Options = options;
    logger?.debug?.("Reading Wtns");
    logger?.debug?.("Reading C Points");
    if (groth16ProveShouldThrow) throw groth16ProveShouldThrow;
    return mockFullProveResult;
  },
);

mock.module("snarkjs", () => ({
  wtns: {
    calculate: wtnsCalculateMock,
  },
  groth16: {
    prove: groth16ProveMock,
  },
}));

const {
  getCircuitArtifactPaths: realGetCircuitArtifactPaths,
  ensureCircuitArtifacts: realEnsureCircuitArtifacts,
  resetCircuitArtifactsCacheForTests: realResetCache,
  overrideCircuitChecksumsForTests: realOverrideChecksums,
} = await import("../../src/services/circuits.ts");

mock.module("../../src/services/circuits.ts", () => ({
  ensureCircuitArtifacts: realEnsureCircuitArtifacts,
  resetCircuitArtifactsCacheForTests: realResetCache,
  overrideCircuitChecksumsForTests: realOverrideChecksums,
  getCircuitArtifactPaths: mock(async (name: string) => {
    if (artifactsShouldThrow) throw artifactsShouldThrow;
    if (proofTestsActive) {
      return {
        wasm: `/mock/artifacts/${name}.wasm`,
        zkey: `/mock/artifacts/${name}.zkey`,
        vkey: `/mock/artifacts/${name}.vkey`,
      };
    }
    return realGetCircuitArtifactPaths(name);
  }),
}));

const {
  deriveWithdrawalTreeDepths,
  proveCommitment,
  proveWithdrawal,
  resetSnarkjsCurveCachesForTests,
  WITHDRAW_CIRCUIT_MAX_TREE_DEPTH,
} = await import(
  "../../src/services/proofs.ts"
);

describe("proofs service", () => {
  beforeEach(() => {
    proofTestsActive = true;
    wtnsCalculateMock.mockClear();
    groth16ProveMock.mockClear();
    capturedFullProveInputs = null;
    capturedFullProveWasm = null;
    capturedFullProveZkey = null;
    capturedWitnessOutput = null;
    capturedGroth16Witness = null;
    capturedGroth16Logger = null;
    capturedGroth16Options = null;
    witnessCalculateShouldThrow = null;
    groth16ProveShouldThrow = null;
    artifactsShouldThrow = null;
    terminateBn128CurveMock.mockClear();
    terminateBls12381CurveMock.mockClear();
    (globalThis as typeof globalThis & {
      curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
      curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
    }).curve_bn128 = null;
    (globalThis as typeof globalThis & {
      curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
      curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
    }).curve_bls12381 = null;
    mockFullProveResult = {
      proof: {
        pi_a: ["1", "2", "3"],
        pi_b: [["4", "5"], ["6", "7"], ["8", "9"]],
        pi_c: ["10", "11", "12"],
      },
      publicSignals: ["100", "200", "300"],
    };
  });

  afterEach(async () => {
    proofTestsActive = false;
    artifactsShouldThrow = null;
    witnessCalculateShouldThrow = null;
    groth16ProveShouldThrow = null;
    capturedGroth16Options = null;
    await resetSnarkjsCurveCachesForTests();
  });

  describe("proveCommitment", () => {
    test("builds the witness with correct commitment inputs", async () => {
      await proveCommitment(1000000000000000000n, 42n, 123n, 456n);

      expect(capturedFullProveInputs).toEqual({
        value: 1000000000000000000n,
        label: 42n,
        nullifier: 123n,
        secret: 456n,
      });
    });

    test("uses commitment circuit artifacts", async () => {
      await proveCommitment(1n, 2n, 3n, 4n);

      expect(capturedFullProveWasm).toBe("/mock/artifacts/commitment.wasm");
      expect(capturedFullProveZkey).toBe("/mock/artifacts/commitment.zkey");
      expect(capturedWitnessOutput).toEqual({ type: "mem" });
      expect(capturedGroth16Witness).toEqual({ type: "mem" });
      expect(capturedGroth16Options).toEqual([]);
    });

    test("does not force a single-thread prover override", async () => {
      await proveCommitment(1n, 2n, 3n, 4n);

      expect(wtnsCalculateMock).toHaveBeenCalledTimes(1);
      expect(groth16ProveMock).toHaveBeenCalledTimes(1);
      expect(groth16ProveMock.mock.calls[0]).toHaveLength(3);
    });

    test("returns proof and publicSignals from snarkjs", async () => {
      const result = await proveCommitment(1n, 2n, 3n, 4n);

      expect(result.proof).toBe(mockFullProveResult.proof);
      expect(result.publicSignals).toBe(mockFullProveResult.publicSignals);
    });

    test("keeps cached snarkjs worker curves alive after proving", async () => {
      (globalThis as typeof globalThis & {
        curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
        curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
      }).curve_bn128 = { terminate: terminateBn128CurveMock };
      (globalThis as typeof globalThis & {
        curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
        curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
      }).curve_bls12381 = { terminate: terminateBls12381CurveMock };

      await proveCommitment(1n, 2n, 3n, 4n);

      expect(terminateBn128CurveMock).not.toHaveBeenCalled();
      expect(terminateBls12381CurveMock).not.toHaveBeenCalled();
    });

    test("wraps snarkjs errors in CLIError with PROOF category", async () => {
      groth16ProveShouldThrow = new Error("WASM execution failed");

      await expect(proveCommitment(1n, 2n, 3n, 4n)).rejects.toMatchObject({
        category: "PROOF",
        code: "PROOF_GENERATION_FAILED",
        message: "Failed to generate commitment proof.",
        hint: expect.stringContaining("WASM execution failed"),
      });
    });

    test("re-throws CLIError from getCircuitArtifactPaths without wrapping", async () => {
      const originalError = new CLIError(
        "Circuit artifacts are missing or failed verification for local proof generation.",
        "PROOF",
        "Expected files in /some/dir.",
        "PROOF_GENERATION_FAILED"
      );
      artifactsShouldThrow = originalError;

      await expect(proveCommitment(1n, 2n, 3n, 4n)).rejects.toBe(originalError);
    });

    test("wraps non-Error thrown values into CLIError hint", async () => {
      groth16ProveShouldThrow = "string error" as unknown as Error;

      await expect(proveCommitment(1n, 2n, 3n, 4n)).rejects.toMatchObject({
        hint: "string error",
      });
    });

    test("reports proof phases from real checkpoints", async () => {
      const phases: string[] = [];

      await proveCommitment(1n, 2n, 3n, 4n, {
        progress: {
          isFirstRun: true,
          markVerificationPhase: () => phases.push("verify circuits if needed"),
          markBuildWitnessPhase: () => phases.push("build witness"),
          markGenerateProofPhase: () => phases.push("generate proof"),
          markFinalizeProofPhase: () => phases.push("finalize proof"),
        },
      });

      expect(phases).toEqual([
        "verify circuits if needed",
        "build witness",
        "generate proof",
        "finalize proof",
      ]);
      expect(capturedGroth16Logger).not.toBeNull();
    });
  });

  describe("proveWithdrawal", () => {
    const makeAccountCommitment = () => ({
      preimage: {
        value: 500n,
        label: 10n,
        precommitment: {
          nullifier: 20n,
          secret: 30n,
        },
      },
      hash: 999n,
      label: 10n,
      value: 500n,
      nullifier: 20n,
      secret: 30n,
      blockNumber: 100n,
      txHash: "0xabc",
    });

    const makeLegacyCommitment = () => ({
      hash: 999n,
      label: 10n,
      value: 500n,
      nullifier: 20n,
      secret: 30n,
      blockNumber: 100n,
      txHash: "0xabc",
    });

    const makeWithdrawalInput = () => ({
      withdrawalAmount: 400n,
      stateRoot: 111n,
      stateTreeDepth: 20n,
      aspRoot: 222n,
      aspTreeDepth: 10n,
      context: 333n,
      newNullifier: 40n,
      newSecret: 50n,
      stateMerkleProof: {
        siblings: [1n, 2n, 3n],
        index: 5,
      },
      aspMerkleProof: {
        siblings: [4n, 5n, 6n],
        index: 7,
      },
    });

    test("derives withdrawal tree depths from the proof siblings", () => {
      expect(
        deriveWithdrawalTreeDepths(makeWithdrawalInput() as any),
      ).toEqual({
        stateTreeDepth: 3n,
        aspTreeDepth: 3n,
      });
    });

    test("rejects withdrawal proofs deeper than the bundled circuit max", () => {
      const tooDeepProof = {
        ...makeWithdrawalInput(),
        stateMerkleProof: {
          siblings: Array(Number(WITHDRAW_CIRCUIT_MAX_TREE_DEPTH) + 1).fill(1n),
          index: 0,
        },
      };

      expect(() =>
        deriveWithdrawalTreeDepths(tooDeepProof as any),
      ).toThrow(CLIError);
    });

    test("uses withdraw circuit artifacts", async () => {
      await proveWithdrawal(
        makeAccountCommitment() as any,
        makeWithdrawalInput() as any
      );

      expect(capturedFullProveWasm).toBe("/mock/artifacts/withdraw.wasm");
      expect(capturedFullProveZkey).toBe("/mock/artifacts/withdraw.zkey");
      expect(capturedWitnessOutput).toEqual({ type: "mem" });
      expect(capturedGroth16Witness).toEqual({ type: "mem" });
      expect(capturedGroth16Options).toEqual([]);
    });

    test("uses the default snarkjs prover options for withdrawals", async () => {
      await proveWithdrawal(
        makeAccountCommitment() as any,
        makeWithdrawalInput() as any
      );

      expect(wtnsCalculateMock).toHaveBeenCalledTimes(1);
      expect(groth16ProveMock).toHaveBeenCalledTimes(1);
      expect(groth16ProveMock.mock.calls[0]).toHaveLength(3);
    });

    test("prepares input signals from AccountCommitment", async () => {
      await proveWithdrawal(
        makeAccountCommitment() as any,
        makeWithdrawalInput() as any
      );

      expect(capturedFullProveInputs).toEqual({
        withdrawnValue: 400n,
        stateRoot: 111n,
        stateTreeDepth: 20n,
        ASPRoot: 222n,
        ASPTreeDepth: 10n,
        context: 333n,
        label: 10n,
        existingValue: 500n,
        existingNullifier: 20n,
        existingSecret: 30n,
        newNullifier: 40n,
        newSecret: 50n,
        stateSiblings: [1n, 2n, 3n],
        stateIndex: 5n,
        ASPSiblings: [4n, 5n, 6n],
        ASPIndex: 7n,
      });
    });

    test("prepares input signals from legacy Commitment", async () => {
      await proveWithdrawal(
        makeLegacyCommitment() as any,
        makeWithdrawalInput() as any
      );

      expect(capturedFullProveInputs).toEqual({
        withdrawnValue: 400n,
        stateRoot: 111n,
        stateTreeDepth: 20n,
        ASPRoot: 222n,
        ASPTreeDepth: 10n,
        context: 333n,
        label: 10n,
        existingValue: 500n,
        existingNullifier: 20n,
        existingSecret: 30n,
        newNullifier: 40n,
        newSecret: 50n,
        stateSiblings: [1n, 2n, 3n],
        stateIndex: 5n,
        ASPSiblings: [4n, 5n, 6n],
        ASPIndex: 7n,
      });
    });

    test("returns proof and publicSignals", async () => {
      const result = await proveWithdrawal(
        makeAccountCommitment() as any,
        makeWithdrawalInput() as any
      );

      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("publicSignals");
    });

    test("wraps snarkjs errors in CLIError with withdrawal message", async () => {
      groth16ProveShouldThrow = new Error("Invalid witness");

      await expect(
        proveWithdrawal(makeAccountCommitment() as any, makeWithdrawalInput() as any)
      ).rejects.toMatchObject({
        category: "PROOF",
        code: "PROOF_GENERATION_FAILED",
        message: "Failed to generate withdrawal proof.",
        hint: expect.stringContaining("Invalid witness"),
      });
    });

    test("keeps cached snarkjs worker curves alive when proving fails", async () => {
      groth16ProveShouldThrow = new Error("Invalid witness");
      (globalThis as typeof globalThis & {
        curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
        curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
      }).curve_bn128 = { terminate: terminateBn128CurveMock };
      (globalThis as typeof globalThis & {
        curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
        curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
      }).curve_bls12381 = { terminate: terminateBls12381CurveMock };

      await expect(
        proveWithdrawal(makeAccountCommitment() as any, makeWithdrawalInput() as any)
      ).rejects.toMatchObject({
        code: "PROOF_GENERATION_FAILED",
      });

      expect(terminateBn128CurveMock).not.toHaveBeenCalled();
      expect(terminateBls12381CurveMock).not.toHaveBeenCalled();
    });

    test("test cleanup terminates cached snarkjs worker curves", async () => {
      (globalThis as typeof globalThis & {
        curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
        curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
      }).curve_bn128 = { terminate: terminateBn128CurveMock };
      (globalThis as typeof globalThis & {
        curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
        curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
      }).curve_bls12381 = { terminate: terminateBls12381CurveMock };

      await resetSnarkjsCurveCachesForTests();

      expect(terminateBn128CurveMock).toHaveBeenCalledTimes(1);
      expect(terminateBls12381CurveMock).toHaveBeenCalledTimes(1);
      expect((globalThis as typeof globalThis & {
        curve_bn128?: { terminate?: typeof terminateBn128CurveMock } | null;
      }).curve_bn128).toBeNull();
      expect((globalThis as typeof globalThis & {
        curve_bls12381?: { terminate?: typeof terminateBls12381CurveMock } | null;
      }).curve_bls12381).toBeNull();
    });

    test("re-throws CLIError from getCircuitArtifactPaths without wrapping", async () => {
      const originalError = new CLIError(
        "No circuit checksum manifest is defined for v999.",
        "PROOF",
        "Update the CLI.",
        "PROOF_GENERATION_FAILED"
      );
      artifactsShouldThrow = originalError;

      await expect(
        proveWithdrawal(makeAccountCommitment() as any, makeWithdrawalInput() as any)
      ).rejects.toBe(originalError);
    });

    test("reports proof phases from witness build through finalize", async () => {
      const phases: string[] = [];

      await proveWithdrawal(
        makeAccountCommitment() as any,
        makeWithdrawalInput() as any,
        {
          progress: {
            isFirstRun: false,
            markVerificationPhase: () => phases.push("verify circuits if needed"),
            markBuildWitnessPhase: () => phases.push("build witness"),
            markGenerateProofPhase: () => phases.push("generate proof"),
            markFinalizeProofPhase: () => phases.push("finalize proof"),
          },
        },
      );

      expect(phases).toEqual([
        "verify circuits if needed",
        "build witness",
        "generate proof",
        "finalize proof",
      ]);
    });
  });
});
