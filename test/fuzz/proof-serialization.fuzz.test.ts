import { describe, expect, test } from "bun:test";
import { stringifyBigInts, toSolidityProof } from "../../src/utils/unsigned.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";

function randBigNumberish(rng: ReturnType<typeof createSeededRng>): string {
  // Keep it deterministic and comfortably within bn parsing bounds.
  return String(BigInt(rng.nextUInt32()) * 1_000_000_000n + BigInt(rng.nextUInt32()));
}

describe("proof serialization fuzz", () => {
  test("toSolidityProof preserves shape and applies Solidity pB reversal", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x33333333);

    for (let i = 0; i < 300; i++) {
      const a0 = randBigNumberish(rng);
      const a1 = randBigNumberish(rng);
      const b00 = randBigNumberish(rng);
      const b01 = randBigNumberish(rng);
      const b10 = randBigNumberish(rng);
      const b11 = randBigNumberish(rng);
      const c0 = randBigNumberish(rng);
      const c1 = randBigNumberish(rng);

      const raw = {
        proof: {
          pi_a: [a0, a1, "1"],
          pi_b: [[b00, b01], [b10, b11], ["1", "0"]],
          pi_c: [c0, c1, "1"],
        },
        publicSignals: Array.from({ length: 8 }, () => randBigNumberish(rng)),
      };

      const solidity = toSolidityProof(raw);

      expect(solidity.pA).toEqual([BigInt(a0), BigInt(a1)]);
      expect(solidity.pB[0]).toEqual([BigInt(b01), BigInt(b00)]);
      expect(solidity.pB[1]).toEqual([BigInt(b11), BigInt(b10)]);
      expect(solidity.pC).toEqual([BigInt(c0), BigInt(c1)]);
      expect(solidity.pubSignals.length).toBe(8);
      for (let j = 0; j < 8; j++) {
        expect(solidity.pubSignals[j]).toBe(BigInt(raw.publicSignals[j]));
      }
    }
  });

  test("stringifyBigInts deeply converts nested bigint values to decimal strings", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x44444444);

    for (let i = 0; i < 200; i++) {
      const input = {
        a: BigInt(rng.nextUInt32()),
        nested: {
          b: BigInt(rng.nextUInt32()),
          arr: [BigInt(rng.nextUInt32()), { c: BigInt(rng.nextUInt32()) }],
        },
      };

      const out = stringifyBigInts(input) as {
        a: string;
        nested: { b: string; arr: Array<string | { c: string }> };
      };

      expect(typeof out.a).toBe("string");
      expect(typeof out.nested.b).toBe("string");
      expect(typeof out.nested.arr[0]).toBe("string");
      expect(typeof (out.nested.arr[1] as { c: string }).c).toBe("string");
    }
  });

  test("malformed proof structures throw CLIError with PROOF_MALFORMED code", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x55555555);

    // Fixed malformed shapes that should all throw PROOF_MALFORMED
    const malformedInputs: unknown[] = [
      // Completely missing structure
      {},
      null,
      undefined,
      { proof: null },
      { proof: "not an object" },
      { proof: 42 },
      // Missing proof arrays
      { proof: {} },
      { proof: { pi_a: [1, 2, 3] } },
      { proof: { pi_a: [1, 2], pi_b: [[1, 2], [3, 4]] } },
      { proof: { pi_b: [[1, 2], [3, 4]], pi_c: [1, 2] } },
      // Arrays present but wrong shape
      { proof: { pi_a: "not-array", pi_b: [[1, 2], [3, 4]], pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: "not-array", pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: [[1, 2], [3, 4]], pi_c: "not-array" }, publicSignals: [] },
      // Short arrays
      { proof: { pi_a: [], pi_b: [[1, 2], [3, 4]], pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1], pi_b: [[1, 2], [3, 4]], pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: [], pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: [[1, 2]], pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: [[1, 2], [3, 4]], pi_c: [] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: [[1, 2], [3, 4]], pi_c: [1] }, publicSignals: [] },
      // pi_b inner arrays not arrays or too short
      { proof: { pi_a: [1, 2], pi_b: [1, [3, 4]], pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: [[1], [3, 4]], pi_c: [1, 2] }, publicSignals: [] },
      { proof: { pi_a: [1, 2], pi_b: [[1, 2], "not"], pi_c: [1, 2] }, publicSignals: [] },
      // Missing publicSignals
      { proof: { pi_a: [1, 2], pi_b: [[1, 2], [3, 4]], pi_c: [1, 2] } },
      { proof: { pi_a: [1, 2], pi_b: [[1, 2], [3, 4]], pi_c: [1, 2] }, publicSignals: "not-array" },
    ];

    for (const input of malformedInputs) {
      try {
        toSolidityProof(input as any);
        throw new Error("Expected CLIError but did not throw");
      } catch (e) {
        expect(e).toBeInstanceOf(CLIError);
        expect((e as CLIError).code).toBe("PROOF_MALFORMED");
        expect((e as CLIError).category).toBe("PROOF");
      }
    }

    // Fuzz random malformed shapes
    for (let i = 0; i < 100; i++) {
      const shape = rng.nextInt(6);
      let malformed: unknown;

      switch (shape) {
        case 0: // Missing proof entirely
          malformed = { publicSignals: [randBigNumberish(rng)] };
          break;
        case 1: // proof is a primitive
          malformed = { proof: rng.nextInt(1000), publicSignals: [] };
          break;
        case 2: { // Short pi_a
          const len = rng.nextInt(2); // 0 or 1
          malformed = {
            proof: {
              pi_a: Array.from({ length: len }, () => randBigNumberish(rng)),
              pi_b: [[randBigNumberish(rng), randBigNumberish(rng)], [randBigNumberish(rng), randBigNumberish(rng)]],
              pi_c: [randBigNumberish(rng), randBigNumberish(rng)],
            },
            publicSignals: [],
          };
          break;
        }
        case 3: { // Short pi_b
          const bLen = rng.nextInt(2); // 0 or 1
          malformed = {
            proof: {
              pi_a: [randBigNumberish(rng), randBigNumberish(rng)],
              pi_b: Array.from({ length: bLen }, () => [randBigNumberish(rng), randBigNumberish(rng)]),
              pi_c: [randBigNumberish(rng), randBigNumberish(rng)],
            },
            publicSignals: [],
          };
          break;
        }
        case 4: { // Short pi_c
          const cLen = rng.nextInt(2); // 0 or 1
          malformed = {
            proof: {
              pi_a: [randBigNumberish(rng), randBigNumberish(rng)],
              pi_b: [[randBigNumberish(rng), randBigNumberish(rng)], [randBigNumberish(rng), randBigNumberish(rng)]],
              pi_c: Array.from({ length: cLen }, () => randBigNumberish(rng)),
            },
            publicSignals: [],
          };
          break;
        }
        case 5: // publicSignals not an array
          malformed = {
            proof: {
              pi_a: [randBigNumberish(rng), randBigNumberish(rng)],
              pi_b: [[randBigNumberish(rng), randBigNumberish(rng)], [randBigNumberish(rng), randBigNumberish(rng)]],
              pi_c: [randBigNumberish(rng), randBigNumberish(rng)],
            },
            publicSignals: rng.nextInt(1000),
          };
          break;
      }

      try {
        toSolidityProof(malformed as any);
        throw new Error("Expected CLIError but did not throw");
      } catch (e) {
        expect(e).toBeInstanceOf(CLIError);
        expect((e as CLIError).code).toBe("PROOF_MALFORMED");
      }
    }
  });
});
