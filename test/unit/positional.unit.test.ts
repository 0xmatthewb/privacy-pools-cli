import { describe, expect, test } from "bun:test";
import {
  resolveAmountAndAssetInput,
  resolveOptionalAssetInput,
} from "../../src/utils/positional.ts";
import { CLIError } from "../../src/utils/errors.ts";

// ── resolveAmountAndAssetInput ───────────────────────────────────────────────

describe("resolveAmountAndAssetInput", () => {
  // -- single positional, no second arg --

  test("returns amount-only when single positional and no flag", () => {
    const result = resolveAmountAndAssetInput("deposit", "100", undefined);
    expect(result).toEqual({ amount: "100" });
    expect(result.asset).toBeUndefined();
  });

  test("returns amount-only for decimal with no second arg", () => {
    const result = resolveAmountAndAssetInput("deposit", "1.5", undefined);
    expect(result).toEqual({ amount: "1.5" });
  });

  // -- decimal edge cases --

  test("accepts .1 (leading dot) as amount-like", () => {
    const result = resolveAmountAndAssetInput("deposit", ".1", "ETH");
    expect(result).toEqual({ amount: ".1", asset: "ETH" });
  });

  test("treats 1. (trailing dot) as NOT amount-like", () => {
    // The regex ^(?:\d+(?:\.\d+)?|\.\d+)$ does not match "1."
    // so "1." is treated as an asset-like token
    const result = resolveAmountAndAssetInput("deposit", "1.", "2.0");
    expect(result).toEqual({ amount: "2.0", asset: "1." });
  });

  test("accepts .0 as amount-like", () => {
    const result = resolveAmountAndAssetInput("deposit", "ETH", ".0");
    expect(result).toEqual({ amount: ".0", asset: "ETH" });
  });

  // -- two positionals happy path --

  test("<amount> <asset> form", () => {
    const result = resolveAmountAndAssetInput("deposit", "10", "ETH");
    expect(result).toEqual({ amount: "10", asset: "ETH" });
  });

  test("<asset> <amount> form", () => {
    const result = resolveAmountAndAssetInput("deposit", "ETH", "10");
    expect(result).toEqual({ amount: "10", asset: "ETH" });
  });

  // -- ambiguous two-positional --

  test("throws when both positionals are amount-like", () => {
    expect(() => resolveAmountAndAssetInput("deposit", "10", "20")).toThrow(CLIError);
  });

  test("throws when neither positional is amount-like", () => {
    expect(() => resolveAmountAndAssetInput("deposit", "ETH", "DAI")).toThrow(CLIError);
  });

  test("inference error message includes command name", () => {
    try {
      resolveAmountAndAssetInput("withdraw", "ETH", "DAI");
      expect(true).toBe(false);
    } catch (err) {
      expect((err as CLIError).message).toContain("withdraw");
    }
  });
});

// ── resolveOptionalAssetInput ────────────────────────────────────────────────

describe("resolveOptionalAssetInput", () => {
  test("returns undefined when both args are undefined", () => {
    expect(resolveOptionalAssetInput("ragequit", undefined)).toBeUndefined();
  });

  test("returns positional asset when provided", () => {
    expect(resolveOptionalAssetInput("ragequit", "ETH")).toBe("ETH");
  });

  test("requires a non-empty command name", () => {
    expect(() => resolveOptionalAssetInput("", "ETH")).toThrow(CLIError);
  });
});
