import { describe, test, expect } from "bun:test";
import { didYouMean } from "../../src/utils/fuzzy.js";

describe("didYouMean", () => {
  test("suggests closest match", () => {
    expect(didYouMean("mainnt", ["mainnet", "arbitrum", "optimism"])).toBe("mainnet");
  });
  test("suggests for case-insensitive input", () => {
    expect(didYouMean("MAINNET", ["mainnet", "arbitrum"])).toBe("mainnet");
  });
  test("returns null when no close match", () => {
    expect(didYouMean("zzzzzzz", ["mainnet", "arbitrum"])).toBeNull();
  });
  test("handles exact match", () => {
    expect(didYouMean("mainnet", ["mainnet", "arbitrum"])).toBe("mainnet");
  });
  test("suggests closest asset symbol", () => {
    expect(didYouMean("USDT", ["ETH", "USDC", "USDT", "DAI"])).toBe("USDT");
  });
  test("suggests close asset typo", () => {
    expect(didYouMean("ETHH", ["ETH", "USDC", "DAI"])).toBe("ETH");
  });
  test("returns null for empty candidates", () => {
    expect(didYouMean("mainnet", [])).toBeNull();
  });
  test("respects custom maxDistance", () => {
    // "maint" vs "mainnet" = distance 2 (missing 'ne')
    expect(didYouMean("maint", ["mainnet"], 1)).toBeNull();
    expect(didYouMean("maint", ["mainnet"], 2)).toBe("mainnet");
  });
});
