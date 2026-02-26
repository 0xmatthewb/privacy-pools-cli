import { describe, expect, test } from "bun:test";
import { formatUnits } from "viem";
import { parseAmount } from "../../src/utils/validation.ts";
import { CLIError } from "../../src/utils/errors.ts";

describe("amount parsing fuzz", () => {
  test("roundtrip parseAmount(formatUnits(x, d), d) over random values", () => {
    const cases = 1000;

    for (let i = 0; i < cases; i++) {
      const decimals = Math.floor(Math.random() * 19);
      const value =
        (BigInt(Math.floor(Math.random() * 1_000_000_000)) << 20n) +
        BigInt(Math.floor(Math.random() * 1_000_000));
      const normalized = value % 10n ** 24n;
      const formatted = formatUnits(normalized, decimals);

      expect(parseAmount(formatted, decimals)).toBe(normalized);
    }
  });

  test("invalid random strings throw CLIError", () => {
    const alphabet = "xyz!@#$%^&*()_+=[]{}|;:,<>?/abcXYZ";

    for (let i = 0; i < 500; i++) {
      const len = 1 + Math.floor(Math.random() * 16);
      let sample = "";
      for (let j = 0; j < len; j++) {
        sample += alphabet[Math.floor(Math.random() * alphabet.length)];
      }

      expect(() => parseAmount(sample, 18)).toThrow(CLIError);
    }
  });
});
