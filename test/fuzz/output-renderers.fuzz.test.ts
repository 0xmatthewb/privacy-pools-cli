import { describe, expect, test } from "bun:test";
import { parseUsd, parseCount } from "../../src/output/stats.ts";
import { deriveTokenPrice, formatUsdValue } from "../../src/utils/format.ts";
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

  test("deriveTokenPrice never throws on random inputs", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xABCD1234);

    // Fixed edge cases
    const edgeCases: Array<Parameters<typeof deriveTokenPrice>[0]> = [
      { decimals: 18 },
      { decimals: 18, acceptedDepositsValue: 0n, acceptedDepositsValueUsd: "0" },
      { decimals: 18, acceptedDepositsValue: 0n, acceptedDepositsValueUsd: "100" },
      { decimals: 18, acceptedDepositsValue: 1n, acceptedDepositsValueUsd: "" },
      { decimals: 18, acceptedDepositsValue: 1n, acceptedDepositsValueUsd: "abc" },
      { decimals: 18, acceptedDepositsValue: 1n, acceptedDepositsValueUsd: "NaN" },
      { decimals: 18, acceptedDepositsValue: 1n, acceptedDepositsValueUsd: "Infinity" },
      { decimals: 0, acceptedDepositsValue: 42n, acceptedDepositsValueUsd: "100" },
      { decimals: 6, totalInPoolValue: 1000000n, totalInPoolValueUsd: "1" },
      { decimals: 18, acceptedDepositsValue: 10n ** 30n, acceptedDepositsValueUsd: "9".repeat(50) },
    ];

    for (const input of edgeCases) {
      const result = deriveTokenPrice(input);
      expect(result === null || typeof result === "number").toBe(true);
      if (typeof result === "number") {
        expect(Number.isFinite(result)).toBe(true);
      }
    }

    // Random inputs
    for (let i = 0; i < 100; i++) {
      const decimals = rng.nextInt(19);
      const valueBits = rng.nextInt(128);
      const value = valueBits === 0 ? 0n : BigInt(rng.nextUInt32()) ** BigInt(rng.nextInt(3) + 1);
      const usdStr = rng.nextInt(3) === 0
        ? undefined
        : String(rng.nextFloat() * 1_000_000);

      const result = deriveTokenPrice({
        decimals,
        acceptedDepositsValue: value,
        acceptedDepositsValueUsd: usdStr,
      });
      expect(result === null || (typeof result === "number" && Number.isFinite(result))).toBe(true);
    }
  });

  test("formatUsdValue never throws on random inputs", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xDEAD5678);

    // Fixed edge cases
    const edgeCases: Array<[bigint, number, number | null]> = [
      [0n, 18, null],
      [0n, 18, 0],
      [0n, 18, 2000],
      [1n, 18, 2000],
      [10n ** 18n, 18, 2000],
      [10n ** 30n, 18, 2000],
      [1n, 0, 1],
      [10n ** 6n, 6, 1],
      [0n, 0, null],
      [1n, 18, Infinity],
      [1n, 18, NaN],
      [1n, 18, -1],
    ];

    for (const [amount, decimals, price] of edgeCases) {
      const result = formatUsdValue(amount, decimals, price);
      expect(typeof result).toBe("string");
      expect(result === "-" || result.startsWith("$")).toBe(true);
    }

    // Random inputs
    for (let i = 0; i < 100; i++) {
      const decimals = rng.nextInt(19);
      const amount = BigInt(rng.nextUInt32()) * BigInt(rng.nextInt(10) + 1);
      const price = rng.nextInt(3) === 0
        ? null
        : rng.nextFloat() * 10000;

      const result = formatUsdValue(amount, decimals, price);
      expect(typeof result).toBe("string");
      expect(result === "-" || result.startsWith("$")).toBe(true);
    }
  });
});
