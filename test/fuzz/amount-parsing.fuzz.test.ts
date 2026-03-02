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

  test("near-valid malformed numeric forms throw CLIError", () => {
    // These are boundary inputs that could bypass a weak regex.
    const nearValid: string[] = [
      // Scientific notation
      "1e18",
      "1E18",
      "1e+5",
      "1e-5",
      "2.5e10",
      // Trailing dot (no fractional digits)
      "1.",
      "100.",
      "0.",
      // Double dots
      "..1",
      "1..2",
      "0..5",
      ".1.2",
      "1.2.3",
      // Leading zeros with junk
      "00x1",
      "0x0",
      // Negative values
      "-1",
      "-0.5",
      "-.5",
      // Plus sign
      "+1",
      "+0.5",
      // Comma separators
      "1,000",
      "1,000.50",
      "1,000,000",
      // Whitespace embedded
      "1 000",
      "1\t0",
      // Unicode digits (Arabic-Indic)
      "\u0661\u0662\u0663",
      // Unicode digits (Devanagari)
      "\u0967\u0968\u0969",
      // Fullwidth digits
      "\uFF11\uFF12\uFF13",
      // Extra separators
      "1_000",
      "1'000",
      // Hex-like
      "0xff",
      "0xFF",
      // Inf/NaN
      "Infinity",
      "-Infinity",
      "NaN",
      // Empty-ish
      ".",
      "",
      " ",
      "\t",
      "\n",
      // Only sign
      "-",
      "+",
      // Huge fractional length (beyond any token's decimal precision)
      "0." + "9".repeat(200),
    ];

    for (const input of nearValid) {
      expect(() => parseAmount(input, 18)).toThrow(CLIError);
    }
  });

  test("precision boundary cases throw CLIError when fraction exceeds decimals", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xb0b0b0b0);

    for (let i = 0; i < 200; i++) {
      const decimals = rng.nextInt(18); // 0–17
      // Generate a valid integer part
      const intPart = String(rng.nextInt(1_000_000));
      // Generate a fractional part that exceeds the allowed decimals
      const fracLen = decimals + 1 + rng.nextInt(5); // always exceeds
      let frac = "";
      for (let j = 0; j < fracLen; j++) {
        frac += String(rng.nextInt(10));
      }
      // Ensure last digit isn't zero (so it truly exceeds precision)
      if (frac.endsWith("0")) {
        frac = frac.slice(0, -1) + String(1 + rng.nextInt(9));
      }

      const sample = `${intPart}.${frac}`;
      expect(() => parseAmount(sample, decimals)).toThrow(CLIError);
    }
  });
});
