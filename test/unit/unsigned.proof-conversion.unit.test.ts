import { describe, expect, test } from "bun:test";
import { toSolidityProof, stringifyBigInts } from "../../src/utils/unsigned.ts";
import { CLIError } from "../../src/utils/errors.ts";

function validRaw(overrides?: Partial<{
  pi_a: unknown[];
  pi_b: unknown[][];
  pi_c: unknown[];
  publicSignals: unknown[];
}>) {
  return {
    proof: {
      pi_a: overrides?.pi_a ?? ["100", "200", "1"],
      pi_b: overrides?.pi_b ?? [["300", "400"], ["500", "600"], ["1", "0"]],
      pi_c: overrides?.pi_c ?? ["700", "800", "1"],
    },
    publicSignals: overrides?.publicSignals ?? ["10", "20", "30"],
  };
}

// ── toSolidityProof ──────────────────────────────────────────────────────────

describe("toSolidityProof", () => {
  test("converts valid Groth16 proof to Solidity layout with pB reversal", () => {
    const result = toSolidityProof(validRaw());

    expect(result.pA).toEqual([100n, 200n]);
    // pB pairs are reversed per Solidity verifier convention
    expect(result.pB[0]).toEqual([400n, 300n]);
    expect(result.pB[1]).toEqual([600n, 500n]);
    expect(result.pC).toEqual([700n, 800n]);
    expect(result.pubSignals).toEqual([10n, 20n, 30n]);
  });

  test("accepts bigint and number inputs alongside strings", () => {
    const raw = validRaw({
      pi_a: [1n, 2, "3"],
      pi_b: [[4n, 5], [6, 7n], ["1", "0"]],
      pi_c: [8n, "9", "1"],
      publicSignals: [10n, 11, "12"],
    });
    const result = toSolidityProof(raw);

    expect(result.pA).toEqual([1n, 2n]);
    expect(result.pB[0]).toEqual([5n, 4n]);
    expect(result.pB[1]).toEqual([7n, 6n]);
    expect(result.pC).toEqual([8n, 9n]);
    expect(result.pubSignals).toEqual([10n, 11n, 12n]);
  });

  test("throws CLIError with PROOF_MALFORMED for non-numeric pi_a field", () => {
    const raw = validRaw({ pi_a: ["not_a_number", "200", "1"] });
    try {
      toSolidityProof(raw);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("PROOF_MALFORMED");
      expect((err as CLIError).message).toContain("proof.pi_a[0]");
    }
  });

  test("throws CLIError with PROOF_MALFORMED for non-numeric pi_b field", () => {
    const raw = validRaw({ pi_b: [["bad", "400"], ["500", "600"], ["1", "0"]] });
    try {
      toSolidityProof(raw);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("PROOF_MALFORMED");
      // pB indices are reversed in the label: pi_b[0][1] reads element [0][0] of input
      expect((err as CLIError).message).toContain("proof.pi_b[0]");
    }
  });

  test("throws CLIError with PROOF_MALFORMED for non-numeric pi_c field", () => {
    const raw = validRaw({ pi_c: ["700", "oops", "1"] });
    try {
      toSolidityProof(raw);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("PROOF_MALFORMED");
      expect((err as CLIError).message).toContain("proof.pi_c[1]");
    }
  });

  test("throws CLIError with PROOF_MALFORMED for non-numeric publicSignals element", () => {
    const raw = validRaw({ publicSignals: ["10", "nope", "30"] });
    try {
      toSolidityProof(raw);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("PROOF_MALFORMED");
      expect((err as CLIError).message).toContain("publicSignals[1]");
    }
  });

  test("throws CLIError with PROOF_MALFORMED for object value in proof field", () => {
    const raw = validRaw({ pi_a: [{}, "200", "1"] });
    expect(() => toSolidityProof(raw)).toThrow(CLIError);
  });

  test("error has category PROOF and regeneration hint", () => {
    const raw = validRaw({ pi_a: ["bad", "200", "1"] });
    try {
      toSolidityProof(raw);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as CLIError).category).toBe("PROOF");
      expect((err as CLIError).hint).toContain("Regenerate");
    }
  });
});

// ── stringifyBigInts ─────────────────────────────────────────────────────────

describe("stringifyBigInts", () => {
  test("returns primitive non-bigint values unchanged", () => {
    expect(stringifyBigInts("hello")).toBe("hello");
    expect(stringifyBigInts(42)).toBe(42);
    expect(stringifyBigInts(null)).toBeNull();
    expect(stringifyBigInts(undefined)).toBeUndefined();
    expect(stringifyBigInts(true)).toBe(true);
  });

  test("converts a top-level bigint to string", () => {
    expect(stringifyBigInts(123n)).toBe("123");
    expect(stringifyBigInts(0n)).toBe("0");
  });

  test("recursively converts nested objects", () => {
    const input = { a: 1n, b: { c: 2n, d: "keep" } };
    expect(stringifyBigInts(input)).toEqual({ a: "1", b: { c: "2", d: "keep" } });
  });

  test("recursively converts arrays containing bigints", () => {
    expect(stringifyBigInts([1n, [2n, 3n]])).toEqual(["1", ["2", "3"]]);
  });

  test("handles mixed arrays of objects and bigints", () => {
    const input = [{ x: 4n }, 5n, "text"];
    expect(stringifyBigInts(input)).toEqual([{ x: "4" }, "5", "text"]);
  });
});
