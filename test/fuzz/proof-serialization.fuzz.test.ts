import { describe, expect, test } from "bun:test";
import { stringifyBigInts, toSolidityProof } from "../../src/utils/unsigned.ts";
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
});
