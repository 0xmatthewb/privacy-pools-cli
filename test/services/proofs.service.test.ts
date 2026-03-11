import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";

/**
 * proofs.ts calls snarkjs.groth16.fullProve and getCircuitArtifactPaths.
 * We mock both to test the proof orchestration and error wrapping logic.
 */

// --- Mock state ---
let mockFullProveResult = {
  proof: {
    pi_a: ["1", "2", "3"],
    pi_b: [["4", "5"], ["6", "7"], ["8", "9"]],
    pi_c: ["10", "11", "12"],
  },
  publicSignals: ["100", "200", "300"],
};
let fullProveShouldThrow: Error | null = null;
let artifactsShouldThrow: Error | null = null;
let proofTestsActive = false;

let capturedFullProveInputs: Record<string, unknown> | null = null;
let capturedFullProveWasm: string | null = null;
let capturedFullProveZkey: string | null = null;

// Mock snarkjs
mock.module("snarkjs", () => ({
  groth16: {
    fullProve: mock(
      async (
        inputs: Record<string, unknown>,
        wasm: string,
        zkey: string
      ) => {
        capturedFullProveInputs = inputs;
        capturedFullProveWasm = wasm;
        capturedFullProveZkey = zkey;
        if (fullProveShouldThrow) throw fullProveShouldThrow;
        return mockFullProveResult;
      }
    ),
  },
}));

// Capture the real function references BEFORE mock.module replaces the
// module namespace.  Module namespace bindings are live, so reading them
// after the mock is installed would return the mocked versions.
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

// Import after mocking
const { proveCommitment, proveWithdrawal } = await import(
  "../../src/services/proofs.ts"
);

describe("proofs service", () => {
  beforeEach(() => {
    proofTestsActive = true;
    capturedFullProveInputs = null;
    capturedFullProveWasm = null;
    capturedFullProveZkey = null;
    fullProveShouldThrow = null;
    artifactsShouldThrow = null;
    mockFullProveResult = {
      proof: {
        pi_a: ["1", "2", "3"],
        pi_b: [["4", "5"], ["6", "7"], ["8", "9"]],
        pi_c: ["10", "11", "12"],
      },
      publicSignals: ["100", "200", "300"],
    };
  });

  afterEach(() => {
    proofTestsActive = false;
    artifactsShouldThrow = null;
    fullProveShouldThrow = null;
  });

  describe("proveCommitment", () => {
    test("calls fullProve with correct commitment inputs", async () => {
      const value = 1000000000000000000n;
      const label = 42n;
      const nullifier = 123n;
      const secret = 456n;

      await proveCommitment(value, label, nullifier, secret);

      expect(capturedFullProveInputs).toEqual({
        value,
        label,
        nullifier,
        secret,
      });
    });

    test("uses commitment circuit artifacts", async () => {
      await proveCommitment(1n, 2n, 3n, 4n);

      expect(capturedFullProveWasm).toBe("/mock/artifacts/commitment.wasm");
      expect(capturedFullProveZkey).toBe("/mock/artifacts/commitment.zkey");
    });

    test("returns proof and publicSignals from snarkjs", async () => {
      const result = await proveCommitment(1n, 2n, 3n, 4n);

      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("publicSignals");
      expect(result.proof).toBe(mockFullProveResult.proof);
      expect(result.publicSignals).toBe(mockFullProveResult.publicSignals);
    });

    test("wraps snarkjs errors in CLIError with PROOF category", async () => {
      fullProveShouldThrow = new Error("WASM execution failed");

      try {
        await proveCommitment(1n, 2n, 3n, 4n);
        expect(true).toBe(false); // should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError);
        const cliError = error as CLIError;
        expect(cliError.category).toBe("PROOF");
        expect(cliError.code).toBe("PROOF_GENERATION_FAILED");
        expect(cliError.message).toBe("Failed to generate commitment proof.");
        expect(cliError.hint).toContain("WASM execution failed");
      }
    });

    test("re-throws CLIError from getCircuitArtifactPaths without wrapping", async () => {
      const originalError = new CLIError(
        "Circuit artifacts are missing or failed verification for local proof generation.",
        "PROOF",
        "Expected files in /some/dir.",
        "PROOF_GENERATION_FAILED"
      );
      artifactsShouldThrow = originalError;

      try {
        await proveCommitment(1n, 2n, 3n, 4n);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBe(originalError);
      }
    });

    test("wraps non-Error thrown values into CLIError hint", async () => {
      fullProveShouldThrow = "string error" as unknown as Error;

      try {
        await proveCommitment(1n, 2n, 3n, 4n);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError);
        const cliError = error as CLIError;
        expect(cliError.hint).toBe("string error");
      }
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

    test("uses withdraw circuit artifacts", async () => {
      await proveWithdrawal(
        makeAccountCommitment() as any,
        makeWithdrawalInput() as any
      );

      expect(capturedFullProveWasm).toBe("/mock/artifacts/withdraw.wasm");
      expect(capturedFullProveZkey).toBe("/mock/artifacts/withdraw.zkey");
    });

    test("prepares input signals from AccountCommitment (preimage path)", async () => {
      const commitment = makeAccountCommitment();
      const input = makeWithdrawalInput();

      await proveWithdrawal(commitment as any, input as any);

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

    test("prepares input signals from legacy Commitment (no preimage)", async () => {
      const commitment = makeLegacyCommitment();
      const input = makeWithdrawalInput();

      await proveWithdrawal(commitment as any, input as any);

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
      fullProveShouldThrow = new Error("Invalid witness");

      try {
        await proveWithdrawal(
          makeAccountCommitment() as any,
          makeWithdrawalInput() as any
        );
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError);
        const cliError = error as CLIError;
        expect(cliError.category).toBe("PROOF");
        expect(cliError.code).toBe("PROOF_GENERATION_FAILED");
        expect(cliError.message).toBe("Failed to generate withdrawal proof.");
        expect(cliError.hint).toContain("Invalid witness");
      }
    });

    test("re-throws CLIError from getCircuitArtifactPaths without wrapping", async () => {
      const originalError = new CLIError(
        "No circuit checksum manifest is defined for v999.",
        "PROOF",
        "Update the CLI.",
        "PROOF_GENERATION_FAILED"
      );
      artifactsShouldThrow = originalError;

      try {
        await proveWithdrawal(
          makeAccountCommitment() as any,
          makeWithdrawalInput() as any
        );
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBe(originalError);
      }
    });
  });
});
