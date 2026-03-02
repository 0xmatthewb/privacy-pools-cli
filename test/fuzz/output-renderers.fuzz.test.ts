import { describe, expect, test } from "bun:test";
import { parseUsd, parseCount } from "../../src/output/stats.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";

/**
 * Fuzz tests for output renderer helper functions.
 * These should never throw regardless of input — they must return
 * a formatted string or the fallback "-".
 */
describe("output renderers fuzz", () => {
  test("parseUsd never throws on random inputs", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xF0F0F0F0);

    // Fixed edge cases
    const edgeCases: unknown[] = [
      null,
      undefined,
      "",
      " ",
      "abc",
      "NaN",
      "Infinity",
      "-Infinity",
      0,
      42,
      -1,
      NaN,
      Infinity,
      true,
      false,
      {},
      [],
      // Valid-ish currency strings
      "1,000",
      "1,000,000.50",
      "$500",
      "1.234.567",
      ",,,",
      "1,2,3",
      "-1,000",
      "0.00",
      // Huge values
      "9".repeat(100),
      // Unicode
      "\u0661\u0662\u0663",
    ];

    for (const input of edgeCases) {
      const result = parseUsd(input);
      expect(typeof result).toBe("string");
      // Must be either a formatted dollar string or "-"
      expect(result === "-" || result.startsWith("$")).toBe(true);
    }

    // Random strings
    for (let i = 0; i < 100; i++) {
      const len = rng.nextInt(50);
      let s = "";
      const chars = "0123456789.,$ -+eE\t\n";
      for (let j = 0; j < len; j++) {
        s += chars[rng.nextInt(chars.length)];
      }

      const result = parseUsd(s);
      expect(typeof result).toBe("string");
      expect(result === "-" || result.startsWith("$")).toBe(true);
    }

  });

  test("parseCount never throws on random inputs", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x0F0F0F0F);

    const edgeCases: unknown[] = [
      null,
      undefined,
      "",
      " ",
      "abc",
      "NaN",
      "Infinity",
      "-Infinity",
      0,
      42,
      -1,
      0.5,
      NaN,
      Infinity,
      -Infinity,
      true,
      false,
      {},
      [],
      // Numeric strings
      "0",
      "42",
      "-5",
      "3.14",
      "1e5",
      "0x10",
      // Large values
      "9".repeat(100),
      String(Number.MAX_SAFE_INTEGER),
    ];

    for (const input of edgeCases) {
      const result = parseCount(input);
      expect(typeof result).toBe("string");
      // Must be a formatted number or "-"
      expect(result === "-" || /^[\d,.-]+$/.test(result)).toBe(true);
    }

    // Random numbers
    for (let i = 0; i < 100; i++) {
      const n = rng.nextInt(2) === 0
        ? rng.nextInt(10_000_000)
        : rng.nextFloat() * 10_000_000;

      const result = parseCount(n);
      expect(typeof result).toBe("string");
      if (Number.isFinite(n)) {
        expect(result).not.toBe("-");
      }
    }

    // Random strings
    for (let i = 0; i < 100; i++) {
      const len = rng.nextInt(30);
      let s = "";
      const chars = "0123456789.,- +eExX";
      for (let j = 0; j < len; j++) {
        s += chars[rng.nextInt(chars.length)];
      }

      const result = parseCount(s);
      expect(typeof result).toBe("string");
    }
  });
});
