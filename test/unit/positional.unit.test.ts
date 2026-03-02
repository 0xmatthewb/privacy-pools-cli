import { describe, expect, test } from "bun:test";
import {
  resolveAmountAndAssetInput,
  resolveOptionalAssetInput,
} from "../../src/utils/positional.ts";
import { CLIError } from "../../src/utils/errors.ts";

// ── resolveAmountAndAssetInput ───────────────────────────────────────────────

describe("resolveAmountAndAssetInput", () => {
  // -- flaggedAsset path (lines 26-35) --

  test("returns amount and flaggedAsset when --asset flag with single positional", () => {
    const result = resolveAmountAndAssetInput("deposit", "1.5", undefined, "ETH");
    expect(result).toEqual({ amount: "1.5", asset: "ETH" });
  });

  test("throws when --asset flag provided with two positionals", () => {
    expect(() =>
      resolveAmountAndAssetInput("deposit", "1.5", "DAI", "ETH")
    ).toThrow(CLIError);
  });

  test("ambiguity error message includes command name", () => {
    try {
      resolveAmountAndAssetInput("deposit", "1.5", "DAI", "ETH");
      expect(true).toBe(false);
    } catch (err) {
      expect((err as CLIError).message).toContain("deposit");
      expect((err as CLIError).message).toContain("Ambiguous");
    }
  });

  test("flaggedAsset does not validate whether first arg is numeric", () => {
    const result = resolveAmountAndAssetInput("deposit", "0xabc", undefined, "USDC");
    expect(result).toEqual({ amount: "0xabc", asset: "USDC" });
  });

  // -- single positional, no second arg, no flag (lines 37-38) --

  test("returns amount-only when single positional and no flag", () => {
    const result = resolveAmountAndAssetInput("deposit", "100", undefined, undefined);
    expect(result).toEqual({ amount: "100" });
    expect(result.asset).toBeUndefined();
  });

  test("returns amount-only for decimal with no second arg", () => {
    const result = resolveAmountAndAssetInput("deposit", "1.5", undefined, undefined);
    expect(result).toEqual({ amount: "1.5" });
  });

  // -- decimal edge cases --

  test("accepts .1 (leading dot) as amount-like", () => {
    const result = resolveAmountAndAssetInput("deposit", ".1", "ETH", undefined);
    expect(result).toEqual({ amount: ".1", asset: "ETH" });
  });

  test("treats 1. (trailing dot) as NOT amount-like", () => {
    // The regex ^(?:\d+(?:\.\d+)?|\.\d+)$ does not match "1."
    // so "1." is treated as an asset-like token
    const result = resolveAmountAndAssetInput("deposit", "1.", "2.0", undefined);
    expect(result).toEqual({ amount: "2.0", asset: "1." });
  });

  test("accepts .0 as amount-like", () => {
    const result = resolveAmountAndAssetInput("deposit", "ETH", ".0", undefined);
    expect(result).toEqual({ amount: ".0", asset: "ETH" });
  });

  // -- two positionals happy path --

  test("<amount> <asset> form", () => {
    const result = resolveAmountAndAssetInput("deposit", "10", "ETH", undefined);
    expect(result).toEqual({ amount: "10", asset: "ETH" });
  });

  test("<asset> <amount> form", () => {
    const result = resolveAmountAndAssetInput("deposit", "ETH", "10", undefined);
    expect(result).toEqual({ amount: "10", asset: "ETH" });
  });

  // -- ambiguous two-positional --

  test("throws when both positionals are amount-like", () => {
    expect(() =>
      resolveAmountAndAssetInput("deposit", "10", "20", undefined)
    ).toThrow(CLIError);
  });

  test("throws when neither positional is amount-like", () => {
    expect(() =>
      resolveAmountAndAssetInput("deposit", "ETH", "DAI", undefined)
    ).toThrow(CLIError);
  });

  test("inference error message includes command name", () => {
    try {
      resolveAmountAndAssetInput("withdraw", "ETH", "DAI", undefined);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as CLIError).message).toContain("withdraw");
    }
  });
});

// ── resolveOptionalAssetInput ────────────────────────────────────────────────

describe("resolveOptionalAssetInput", () => {
  test("returns undefined when both args are undefined", () => {
    expect(resolveOptionalAssetInput("ragequit", undefined, undefined)).toBeUndefined();
  });

  test("returns positional asset when only positional provided", () => {
    expect(resolveOptionalAssetInput("ragequit", "ETH", undefined)).toBe("ETH");
  });

  test("returns flagged asset when only flag provided", () => {
    expect(resolveOptionalAssetInput("ragequit", undefined, "USDC")).toBe("USDC");
  });

  test("throws CLIError when both positional and flag provided", () => {
    expect(() =>
      resolveOptionalAssetInput("ragequit", "ETH", "USDC")
    ).toThrow(CLIError);
  });

  test("error message includes command name and 'Ambiguous'", () => {
    try {
      resolveOptionalAssetInput("ragequit", "ETH", "USDC");
      expect(true).toBe(false);
    } catch (err) {
      expect((err as CLIError).message).toContain("ragequit");
      expect((err as CLIError).message).toContain("Ambiguous asset input");
    }
  });
});
