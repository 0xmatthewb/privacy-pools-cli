import { describe, test, expect } from "bun:test";
import {
  isRoundAmount,
  isStablecoin,
  suggestRoundAmounts,
  formatAmountDecimal,
} from "../../src/utils/amount-privacy.js";

// Helpers — parse human-readable amount to bigint using token decimals
function parseAmount(human: string, decimals: number): bigint {
  const [whole, frac = ""] = human.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

const ETH_DECIMALS = 18;
const USDC_DECIMALS = 6;

describe("isStablecoin", () => {
  test("recognizes known stablecoins", () => {
    expect(isStablecoin("USDC")).toBe(true);
    expect(isStablecoin("usdc")).toBe(true);
    expect(isStablecoin("USDT")).toBe(true);
    expect(isStablecoin("DAI")).toBe(true);
    expect(isStablecoin("FRAX")).toBe(true);
    expect(isStablecoin("LUSD")).toBe(true);
  });

  test("rejects non-stablecoins", () => {
    expect(isStablecoin("ETH")).toBe(false);
    expect(isStablecoin("WETH")).toBe(false);
    expect(isStablecoin("BOLD")).toBe(false);
  });
});

describe("isRoundAmount — stablecoins (USDC, 6 decimals)", () => {
  test.each([
    ["100", true],
    ["490", true],
    ["495", true],
    ["500", true],
    ["505", true],
    ["1000", true],
    ["5", true],
    ["99", true],
    ["1", true],
  ])("%s USDC → round = %s", (human, expected) => {
    expect(isRoundAmount(parseAmount(human, USDC_DECIMALS), USDC_DECIMALS, "USDC")).toBe(expected);
  });

  test.each([
    ["490.19", false],
    ["100.50", false],
    ["500.5", false],
    ["99.99", false],
    ["490.19294", false],
    ["0.01", false],
  ])("%s USDC → round = %s", (human, expected) => {
    expect(isRoundAmount(parseAmount(human, USDC_DECIMALS), USDC_DECIMALS, "USDC")).toBe(expected);
  });
});

describe("isRoundAmount — volatile assets (ETH, 18 decimals)", () => {
  test.each([
    ["0.1", true],
    ["1.0", true],
    ["1.01", true],
    ["1.25", true],
    ["0.5", true],
    ["10", true],
    ["1.99", true],
    ["0.05", true],
    ["0.01", true],
  ])("%s ETH → round = %s", (human, expected) => {
    expect(isRoundAmount(parseAmount(human, ETH_DECIMALS), ETH_DECIMALS, "ETH")).toBe(expected);
  });

  test.each([
    ["1.276848", false],
    ["0.123", false],
    ["1.015", false],
    ["3.14159", false],
    ["0.001", false],
    ["0.00567", false],
  ])("%s ETH → round = %s", (human, expected) => {
    expect(isRoundAmount(parseAmount(human, ETH_DECIMALS), ETH_DECIMALS, "ETH")).toBe(expected);
  });
});

describe("suggestRoundAmounts — stablecoins", () => {
  test("490.19294 USDC → suggests 490", () => {
    const amount = parseAmount("490.19294", USDC_DECIMALS);
    const suggestions = suggestRoundAmounts(amount, USDC_DECIMALS, "USDC");
    const humanSuggestions = suggestions.map((s) => formatAmountDecimal(s, USDC_DECIMALS));
    expect(humanSuggestions).toContain("490");
  });

  test("100.50 USDC → suggests 100", () => {
    const amount = parseAmount("100.50", USDC_DECIMALS);
    const suggestions = suggestRoundAmounts(amount, USDC_DECIMALS, "USDC");
    const humanSuggestions = suggestions.map((s) => formatAmountDecimal(s, USDC_DECIMALS));
    expect(humanSuggestions).toContain("100");
  });

  test("500.5 USDC → suggests 500", () => {
    const amount = parseAmount("500.5", USDC_DECIMALS);
    const suggestions = suggestRoundAmounts(amount, USDC_DECIMALS, "USDC");
    const humanSuggestions = suggestions.map((s) => formatAmountDecimal(s, USDC_DECIMALS));
    expect(humanSuggestions).toContain("500");
  });
});

describe("suggestRoundAmounts — volatile assets", () => {
  test("1.276848 ETH → includes 1.27 and 1.25", () => {
    const amount = parseAmount("1.276848", ETH_DECIMALS);
    const suggestions = suggestRoundAmounts(amount, ETH_DECIMALS, "ETH");
    const humanSuggestions = suggestions.map((s) => formatAmountDecimal(s, ETH_DECIMALS));
    expect(humanSuggestions).toContain("1.27");
    expect(humanSuggestions).toContain("1.25");
  });

  test("3.14159 ETH → includes 3.14 and 3.1", () => {
    const amount = parseAmount("3.14159", ETH_DECIMALS);
    const suggestions = suggestRoundAmounts(amount, ETH_DECIMALS, "ETH");
    const humanSuggestions = suggestions.map((s) => formatAmountDecimal(s, ETH_DECIMALS));
    expect(humanSuggestions).toContain("3.14");
    expect(humanSuggestions).toContain("3.1");
  });

  test("0.123 ETH → includes 0.12 and 0.1", () => {
    const amount = parseAmount("0.123", ETH_DECIMALS);
    const suggestions = suggestRoundAmounts(amount, ETH_DECIMALS, "ETH");
    const humanSuggestions = suggestions.map((s) => formatAmountDecimal(s, ETH_DECIMALS));
    expect(humanSuggestions).toContain("0.12");
    expect(humanSuggestions).toContain("0.1");
  });
});

describe("suggestRoundAmounts — invariants", () => {
  const testCases: [string, number, string][] = [
    ["490.19294", USDC_DECIMALS, "USDC"],
    ["100.50", USDC_DECIMALS, "USDC"],
    ["1.276848", ETH_DECIMALS, "ETH"],
    ["3.14159", ETH_DECIMALS, "ETH"],
    ["0.00567", ETH_DECIMALS, "ETH"],
    ["0.123", ETH_DECIMALS, "WETH"],
  ];

  test.each(testCases)(
    "all suggestions for %s %s are ≤ original (balance-safe)",
    (human, decimals, symbol) => {
      const amount = parseAmount(human, decimals);
      const suggestions = suggestRoundAmounts(amount, decimals, symbol);
      for (const s of suggestions) {
        expect(s).toBeLessThanOrEqual(amount);
      }
    },
  );

  test.each(testCases)(
    "no suggestion equals the original amount (%s %s)",
    (human, decimals, symbol) => {
      const amount = parseAmount(human, decimals);
      const suggestions = suggestRoundAmounts(amount, decimals, symbol);
      for (const s of suggestions) {
        expect(s).not.toBe(amount);
      }
    },
  );

  test.each(testCases)(
    "all suggestions pass isRoundAmount (%s %s)",
    (human, decimals, symbol) => {
      const amount = parseAmount(human, decimals);
      const suggestions = suggestRoundAmounts(amount, decimals, symbol);
      for (const s of suggestions) {
        expect(isRoundAmount(s, decimals, symbol)).toBe(true);
      }
    },
  );

  test("returns empty array for already-round amounts", () => {
    expect(suggestRoundAmounts(parseAmount("100", USDC_DECIMALS), USDC_DECIMALS, "USDC")).toEqual([]);
    expect(suggestRoundAmounts(parseAmount("1.25", ETH_DECIMALS), ETH_DECIMALS, "ETH")).toEqual([]);
  });
});

describe("formatAmountDecimal", () => {
  test("formats whole numbers without trailing zeros", () => {
    expect(formatAmountDecimal(parseAmount("100", USDC_DECIMALS), USDC_DECIMALS)).toBe("100");
    expect(formatAmountDecimal(parseAmount("1", ETH_DECIMALS), ETH_DECIMALS)).toBe("1");
  });

  test("formats decimals and strips trailing zeros", () => {
    expect(formatAmountDecimal(parseAmount("1.25", ETH_DECIMALS), ETH_DECIMALS)).toBe("1.25");
    expect(formatAmountDecimal(parseAmount("0.1", ETH_DECIMALS), ETH_DECIMALS)).toBe("0.1");
    expect(formatAmountDecimal(parseAmount("490.19294", USDC_DECIMALS), USDC_DECIMALS)).toBe("490.19294");
  });
});
