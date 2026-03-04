/**
 * Unit tests for isPercentageAmount() and percentage-related positional parsing.
 */

import { describe, expect, test } from "bun:test";
import { isPercentageAmount, resolveAmountAndAssetInput } from "../../src/utils/positional.ts";

// ── isPercentageAmount ──────────────────────────────────────────────────────

describe("isPercentageAmount", () => {
  test("integer percentage", () => {
    expect(isPercentageAmount("50%")).toBe(true);
  });

  test("decimal percentage", () => {
    expect(isPercentageAmount("33.5%")).toBe(true);
  });

  test("rejects plain number", () => {
    expect(isPercentageAmount("50")).toBe(false);
  });

  test("rejects percent-only", () => {
    expect(isPercentageAmount("%")).toBe(false);
  });

  test("rejects asset symbol", () => {
    expect(isPercentageAmount("ETH")).toBe(false);
  });

  test("rejects leading-dot percentage", () => {
    // ".5%" has no integer part before the dot — the regex requires \d+
    expect(isPercentageAmount(".5%")).toBe(false);
  });

  test("rejects percent in middle", () => {
    expect(isPercentageAmount("50%ETH")).toBe(false);
  });
});

// ── Percentage in resolveAmountAndAssetInput ────────────────────────────────

describe("resolveAmountAndAssetInput with percentages", () => {
  test("50% is amount-like, paired with asset", () => {
    const result = resolveAmountAndAssetInput("withdraw", "50%", "ETH", undefined);
    expect(result).toEqual({ amount: "50%", asset: "ETH" });
  });

  test("asset first, percentage second", () => {
    const result = resolveAmountAndAssetInput("withdraw", "ETH", "50%", undefined);
    expect(result).toEqual({ amount: "50%", asset: "ETH" });
  });

  test("percentage with --asset flag", () => {
    const result = resolveAmountAndAssetInput("withdraw", "50%", undefined, "ETH");
    expect(result).toEqual({ amount: "50%", asset: "ETH" });
  });
});
