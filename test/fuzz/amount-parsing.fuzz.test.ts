import { describe, expect, test } from "bun:test";
import { formatUnits } from "viem";
import { parseAmount } from "../../src/utils/validation.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";

describe("amount parsing fuzz", () => {
  test("roundtrip parseAmount(formatUnits(x, d), d) over random values", () => {
    const rng = createSeededRng(getFuzzSeed());
    const cases = 1000;

    for (let i = 0; i < cases; i++) {
      const decimals = rng.nextInt(19);
      const value =
        (BigInt(rng.nextInt(1_000_000_000)) << 20n) +
        BigInt(rng.nextInt(1_000_000));
      const normalized = value % 10n ** 24n;
      const formatted = formatUnits(normalized, decimals);

      expect(parseAmount(formatted, decimals)).toBe(normalized);
    }
  });

  test("invalid random strings throw CLIError", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xa5a5a5a5);
    const alphabet = "xyz!@#$%^&*()_+=[]{}|;:,<>?/abcXYZ";

    for (let i = 0; i < 500; i++) {
      const len = 1 + rng.nextInt(16);
      let sample = "";
      for (let j = 0; j < len; j++) {
        sample += alphabet[rng.nextInt(alphabet.length)];
      }

      expect(() => parseAmount(sample, 18)).toThrow(CLIError);
    }
  });
});
