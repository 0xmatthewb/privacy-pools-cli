/**
 * Unit tests for pure utility functions exported from command modules.
 *
 * These functions are the core parsing/formatting logic used inside commands.
 * Testing them directly (without subprocess overhead) catches edge cases faster
 * and follows the gh/Stripe pattern of unit-testing command internals.
 */

import { describe, expect, test } from "bun:test";
import { parseUsd, parseCount } from "../../src/commands/stats.ts";
import { parsePositiveInt, parseNumberish } from "../../src/commands/activity.ts";
import { parseGasFeeOverrides } from "../../src/utils/gas-fees.ts";
import { CLIError } from "../../src/utils/errors.ts";

// ── parseGasFeeOverrides ────────────────────────────────────────────────────

describe("parseGasFeeOverrides", () => {
  test("parses legacy and EIP-1559 gwei fee caps", () => {
    expect(parseGasFeeOverrides({ gasPrice: "1.5" })).toEqual({
      gasPrice: 1500000000n,
    });
    expect(parseGasFeeOverrides({
      maxFeePerGas: "30",
      maxPriorityFeePerGas: "2",
    })).toEqual({
      maxFeePerGas: 30000000000n,
      maxPriorityFeePerGas: 2000000000n,
    });
  });

  test("rejects conflicting gas fee modes", () => {
    expect(() =>
      parseGasFeeOverrides({ gasPrice: "1", maxFeePerGas: "2" }),
    ).toThrow(CLIError);
  });
});

// ── parseUsd ────────────────────────────────────────────────────────────────

describe("parseUsd", () => {
  test("formats a plain number string as USD", () => {
    expect(parseUsd("123456")).toBe("$123,456");
  });

  test("strips commas before parsing", () => {
    expect(parseUsd("1,234,567")).toBe("$1,234,567");
  });

  test("rounds fractional digits", () => {
    expect(parseUsd("1234.99")).toBe("$1,235");
  });

  test("handles zero", () => {
    expect(parseUsd("0")).toBe("$0");
  });

  test("returns dash for empty string", () => {
    expect(parseUsd("")).toBe("-");
  });

  test("returns dash for whitespace-only string", () => {
    expect(parseUsd("   ")).toBe("-");
  });

  test("returns dash for non-numeric string", () => {
    expect(parseUsd("abc")).toBe("-");
  });

  test("returns dash for null", () => {
    expect(parseUsd(null)).toBe("-");
  });

  test("returns dash for undefined", () => {
    expect(parseUsd(undefined)).toBe("-");
  });

  test("returns dash for number type (expects string input)", () => {
    expect(parseUsd(42)).toBe("-");
  });

  test("returns dash for NaN string", () => {
    expect(parseUsd("NaN")).toBe("-");
  });

  test("returns dash for Infinity string", () => {
    expect(parseUsd("Infinity")).toBe("-");
  });
});

// ── parseCount ──────────────────────────────────────────────────────────────

describe("parseCount", () => {
  test("formats a finite number with locale separators", () => {
    expect(parseCount(1234567)).toBe("1,234,567");
  });

  test("floors fractional numbers", () => {
    expect(parseCount(1234.99)).toBe("1,234");
  });

  test("handles zero", () => {
    expect(parseCount(0)).toBe("0");
  });

  test("parses a numeric string", () => {
    expect(parseCount("5678")).toBe("5,678");
  });

  test("floors a fractional string", () => {
    expect(parseCount("999.7")).toBe("999");
  });

  test("returns dash for NaN", () => {
    expect(parseCount(NaN)).toBe("-");
  });

  test("returns dash for Infinity", () => {
    expect(parseCount(Infinity)).toBe("-");
  });

  test("returns dash for non-numeric string", () => {
    expect(parseCount("abc")).toBe("-");
  });

  test("returns dash for empty string", () => {
    expect(parseCount("")).toBe("-");
  });

  test("returns dash for whitespace-only string", () => {
    expect(parseCount("   ")).toBe("-");
  });

  test("returns dash for null", () => {
    expect(parseCount(null)).toBe("-");
  });

  test("returns dash for undefined", () => {
    expect(parseCount(undefined)).toBe("-");
  });

  test("returns dash for boolean", () => {
    expect(parseCount(true)).toBe("-");
  });
});

// ── parsePositiveInt ────────────────────────────────────────────────────────

describe("parsePositiveInt", () => {
  test("parses a valid positive integer string", () => {
    expect(parsePositiveInt("5", "limit")).toBe(5);
  });

  test("parses '1' correctly", () => {
    expect(parsePositiveInt("1", "page")).toBe(1);
  });

  test("uses page default (1) when undefined and fieldName is 'page'", () => {
    expect(parsePositiveInt(undefined, "page")).toBe(1);
  });

  test("uses limit default (12) when undefined and fieldName is 'limit'", () => {
    expect(parsePositiveInt(undefined, "limit")).toBe(12);
  });

  test("throws CLIError for zero", () => {
    expect(() => parsePositiveInt("0", "page")).toThrow();
  });

  test("throws CLIError for negative number", () => {
    expect(() => parsePositiveInt("-3", "limit")).toThrow();
  });

  test("throws CLIError for fractional number", () => {
    expect(() => parsePositiveInt("1.5", "page")).toThrow();
  });

  test("throws CLIError for non-numeric string", () => {
    expect(() => parsePositiveInt("abc", "limit")).toThrow();
  });

  test("throws CLIError for empty string", () => {
    expect(() => parsePositiveInt("", "page")).toThrow();
  });

  test("error message includes field name", () => {
    try {
      parsePositiveInt("abc", "limit");
    } catch (err: any) {
      expect(err.message).toContain("--limit");
    }
  });
});

// ── parseNumberish ──────────────────────────────────────────────────────────

describe("parseNumberish", () => {
  test("returns finite number as-is", () => {
    expect(parseNumberish(42)).toBe(42);
  });

  test("returns float as-is", () => {
    expect(parseNumberish(3.14)).toBe(3.14);
  });

  test("returns zero", () => {
    expect(parseNumberish(0)).toBe(0);
  });

  test("parses a numeric string", () => {
    expect(parseNumberish("123")).toBe(123);
  });

  test("parses a fractional string", () => {
    expect(parseNumberish("1.5")).toBe(1.5);
  });

  test("returns null for NaN", () => {
    expect(parseNumberish(NaN)).toBeNull();
  });

  test("returns null for Infinity", () => {
    expect(parseNumberish(Infinity)).toBeNull();
  });

  test("returns null for -Infinity", () => {
    expect(parseNumberish(-Infinity)).toBeNull();
  });

  test("returns null for non-numeric string", () => {
    expect(parseNumberish("abc")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseNumberish("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(parseNumberish("   ")).toBeNull();
  });

  test("returns null for null", () => {
    expect(parseNumberish(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(parseNumberish(undefined)).toBeNull();
  });

  test("returns null for boolean", () => {
    expect(parseNumberish(true)).toBeNull();
  });

  test("returns null for object", () => {
    expect(parseNumberish({})).toBeNull();
  });

  test("returns null for array", () => {
    expect(parseNumberish([1, 2])).toBeNull();
  });

  test("returns negative number", () => {
    expect(parseNumberish(-5)).toBe(-5);
  });

  test("parses negative string", () => {
    expect(parseNumberish("-10")).toBe(-10);
  });
});
