import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  formatAddress,
  formatAmount,
  formatBPS,
  formatTxHash,
  deriveTokenPrice,
  formatUsdValue,
  isStablecoinPrice,
  usdSuffix,
  info,
  printTable,
  stageHeader,
  success,
  verbose,
  warn,
} from "../../src/utils/format.ts";

const originalLog = console.log;
const originalStderrWrite = process.stderr.write.bind(process.stderr);

describe("format utils matrix", () => {
  afterEach(() => {
    console.log = originalLog;
    process.stderr.write = originalStderrWrite as typeof process.stderr.write;
    mock.restore();
  });

  const AMOUNT_CASES = [
    [0n, 18, undefined, "0"],
    [1n, 18, undefined, "0.000000000000000001"],
    [1000000000000000000n, 18, undefined, "1"],
    [1000000000000000000n, 18, "ETH", "1 ETH"],
    [1234567n, 6, "USDC", "1.234567 USDC"],
    [42n, 0, "TOK", "42 TOK"],
    [314159n, 5, undefined, "3.14159"],
    [271828n, 5, "PI", "2.71828 PI"],
  ] as const;

  for (const [value, decimals, symbol, expected] of AMOUNT_CASES) {
    test(`formatAmount(${value}, ${decimals}, ${String(symbol)})`, () => {
      expect(formatAmount(value, decimals, symbol as string | undefined)).toBe(
        expected
      );
    });
  }

  const ADDRESS_CASES = [
    ["0x1234", 6, "0x1234"],
    ["0x1234567890abcdef1234567890abcdef12345678", 4, "0x1234...5678"],
    ["0x1234567890abcdef1234567890abcdef12345678", 6, "0x123456...345678"],
    ["0x1234567890abcdef1234567890abcdef12345678", 8, "0x12345678...12345678"],
    ["0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", 5, "0xabcde...fabcd"],
    ["0x1111111111111111111111111111111111111111", 3, "0x111...111"],
    ["0x2222222222222222222222222222222222222222", 2, "0x22...22"],
    ["0x3333333333333333333333333333333333333333", 1, "0x3...3"],
    ["0x4444444444444444444444444444444444444444", 7, "0x4444444...4444444"],
    ["0x5555555555555555555555555555555555555555", 9, "0x555555555...555555555"],
  ] as const;

  for (const [address, chars, expected] of ADDRESS_CASES) {
    test(`formatAddress chars=${chars}`, () => {
      expect(formatAddress(address, chars)).toBe(expected);
    });
  }

  const BPS_CASES = [
    [0n, "0.00%"],
    [1n, "0.01%"],
    [10n, "0.10%"],
    [50n, "0.50%"],
    [100n, "1.00%"],
    [123n, "1.23%"],
    [250n, "2.50%"],
    [999n, "9.99%"],
    [1000n, "10.00%"],
    [10000n, "100.00%"],
  ] as const;

  for (const [bps, expected] of BPS_CASES) {
    test(`formatBPS(${bps})`, () => {
      expect(formatBPS(bps)).toBe(expected);
    });
  }

  test("formatTxHash delegates to formatAddress with 8 chars", () => {
    const hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    expect(formatTxHash(hash)).toBe("0x12345678...90abcdef");
  });

  test("printTable renders table to stderr", () => {
    const logs: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    printTable(
      ["Asset", "Balance"],
      [
        ["ETH", "1"],
        ["USDC", "10"],
      ]
    );

    expect(logs.length).toBeGreaterThan(0);
    const output = logs.join("");
    expect(output).toContain("Asset");
    expect(output).toContain("Balance");
    expect(output).toContain("ETH");
    expect(output).toContain("USDC");
  });

  test("printTable falls back to stacked rows on narrow terminals", () => {
    const logs: string[] = [];
    const originalColumns = process.stderr.columns;
    Object.defineProperty(process.stderr, "columns", {
      configurable: true,
      get: () => 72,
    });
    process.stderr.write = ((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    printTable(
      ["Asset", "Balance"],
      [
        ["ETH", "1"],
        ["USDC", "10"],
      ],
    );

    if (originalColumns !== undefined) {
      Object.defineProperty(process.stderr, "columns", {
        configurable: true,
        get: () => originalColumns,
      });
    }

    const output = logs.join("");
    expect(output).toContain("Asset");
    expect(output).toContain("Balance");
    expect(output).not.toContain("┌");
  });

  test("success/warn/info/verbose formatting emits expected markers", () => {
    const logs: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    success("ok");
    warn("careful");
    info("heads-up");
    verbose("quiet", false);
    verbose("noisy", true);

    expect(logs.some((l) => /(?:✓|ok) ok/.test(l))).toBe(true);
    expect(logs.some((l) => /(?:⚠|!) careful/.test(l))).toBe(true);
    expect(logs.some((l) => /(?:ℹ|i) heads-up/.test(l))).toBe(true);
    expect(logs.some((l) => l.includes("quiet"))).toBe(false);
    expect(logs.some((l) => l.includes("noisy"))).toBe(true);
  });

  test("stageHeader writes step banner to stderr", () => {
    const logs: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    stageHeader(2, 5, "Building proofs");

    const output = logs.join("");
    expect(output).toContain("(2/5)");
    expect(output).toContain("Building proofs");
  });

  test("stageHeader is silent when quiet=true", () => {
    const logs: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    stageHeader(1, 3, "Loading", true);

    expect(logs.length).toBe(0);
  });

  test("quiet logging suppresses output", () => {
    const logs: string[] = [];
    process.stderr.write = ((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    success("ok", true);
    warn("careful", true);
    info("heads-up", true);
    verbose("noisy", true, true);

    expect(logs.length).toBe(0);
  });

  // ── deriveTokenPrice ────────────────────────────────────────────────────────

  describe("deriveTokenPrice", () => {
    test("derives price from acceptedDepositsValue/Usd", () => {
      const price = deriveTokenPrice({
        decimals: 18,
        acceptedDepositsValue: 10000000000000000000n, // 10 ETH
        acceptedDepositsValueUsd: "20000",            // $20,000
      });
      expect(price).toBeCloseTo(2000, 0);
    });

    test("falls back to totalInPool when accepted is missing", () => {
      const price = deriveTokenPrice({
        decimals: 18,
        totalInPoolValue: 5000000000000000000n,  // 5 ETH
        totalInPoolValueUsd: "15000",            // $15,000
      });
      expect(price).toBeCloseTo(3000, 0);
    });

    test("prefers accepted over totalInPool", () => {
      const price = deriveTokenPrice({
        decimals: 18,
        acceptedDepositsValue: 10000000000000000000n,
        acceptedDepositsValueUsd: "20000",
        totalInPoolValue: 100000000000000000000n,
        totalInPoolValueUsd: "1000",
      });
      // Should use accepted: 20000 / 10 = 2000
      expect(price).toBeCloseTo(2000, 0);
    });

    test("returns null when USD string is missing", () => {
      expect(deriveTokenPrice({
        decimals: 18,
        acceptedDepositsValue: 10000000000000000000n,
      })).toBeNull();
    });

    test("returns null when token value is 0", () => {
      expect(deriveTokenPrice({
        decimals: 18,
        acceptedDepositsValue: 0n,
        acceptedDepositsValueUsd: "100",
      })).toBeNull();
    });

    test("returns null when token value is undefined", () => {
      expect(deriveTokenPrice({
        decimals: 18,
        acceptedDepositsValueUsd: "100",
      })).toBeNull();
    });

    test("returns null for non-numeric USD string", () => {
      expect(deriveTokenPrice({
        decimals: 18,
        acceptedDepositsValue: 1000000000000000000n,
        acceptedDepositsValueUsd: "abc",
      })).toBeNull();
    });

    test("handles 6-decimal tokens (USDC)", () => {
      const price = deriveTokenPrice({
        decimals: 6,
        acceptedDepositsValue: 1000000000n, // 1000 USDC
        acceptedDepositsValueUsd: "1000",
      });
      expect(price).toBeCloseTo(1, 2);
    });

    test("strips commas from USD string", () => {
      const price = deriveTokenPrice({
        decimals: 18,
        acceptedDepositsValue: 1000000000000000000n,
        acceptedDepositsValueUsd: "2,500",
      });
      expect(price).toBeCloseTo(2500, 0);
    });
  });

  // ── formatUsdValue ──────────────────────────────────────────────────────────

  describe("formatUsdValue", () => {
    test("formats token amount at given price", () => {
      // 1 ETH at $2000
      expect(formatUsdValue(1000000000000000000n, 18, 2000)).toBe("$2,000");
    });

    test("formats fractional amounts", () => {
      // 0.5 ETH at $2000 = $1000
      expect(formatUsdValue(500000000000000000n, 18, 2000)).toBe("$1,000");
    });

    test("returns dash when price is null", () => {
      expect(formatUsdValue(1000000000000000000n, 18, null)).toBe("-");
    });

    test("formats 6-decimal tokens", () => {
      // 100 USDC at $1
      expect(formatUsdValue(100000000n, 6, 1)).toBe("$100");
    });

    test("rounds to zero decimal places", () => {
      // 1 ETH at $2000.50 → $2,001 (rounds)
      expect(formatUsdValue(1000000000000000000n, 18, 2000.5)).toBe("$2,001");
    });

    test("handles zero amount", () => {
      expect(formatUsdValue(0n, 18, 2000)).toBe("$0");
    });

    test("handles very small amounts", () => {
      // 1 wei at $2000 ≈ $0
      expect(formatUsdValue(1n, 18, 2000)).toBe("$0");
    });
  });

  // ── isStablecoinPrice ────────────────────────────────────────────────────────

  describe("isStablecoinPrice", () => {
    test("returns false for null", () => {
      expect(isStablecoinPrice(null)).toBe(false);
    });

    test("returns true for $1.00 (USDC/DAI)", () => {
      expect(isStablecoinPrice(1.0)).toBe(true);
    });

    test("returns true for $0.999 (slightly depegged stablecoin)", () => {
      expect(isStablecoinPrice(0.999)).toBe(true);
    });

    test("returns true at lower boundary ($0.90)", () => {
      expect(isStablecoinPrice(0.90)).toBe(true);
    });

    test("returns true at upper boundary ($1.10)", () => {
      expect(isStablecoinPrice(1.10)).toBe(true);
    });

    test("returns false below stablecoin range ($0.89)", () => {
      expect(isStablecoinPrice(0.89)).toBe(false);
    });

    test("returns false above stablecoin range ($1.11)", () => {
      expect(isStablecoinPrice(1.11)).toBe(false);
    });

    test("returns false for ETH-like price ($3200)", () => {
      expect(isStablecoinPrice(3200)).toBe(false);
    });

    test("returns false for zero", () => {
      expect(isStablecoinPrice(0)).toBe(false);
    });
  });

  // ── usdSuffix ────────────────────────────────────────────────────────────────

  describe("usdSuffix", () => {
    test("returns formatted suffix for non-stablecoin", () => {
      // 0.1 ETH at $3200 = ~$320
      expect(usdSuffix(100000000000000000n, 18, 3200)).toBe(" (~$320)");
    });

    test("returns empty string for null price", () => {
      expect(usdSuffix(100000000000000000n, 18, null)).toBe("");
    });

    test("returns empty string for stablecoin price ($1.00)", () => {
      expect(usdSuffix(100000000n, 6, 1.0)).toBe("");
    });

    test("returns empty string for stablecoin price ($0.999)", () => {
      expect(usdSuffix(100000000n, 6, 0.999)).toBe("");
    });

    test("comma-formats large USD values", () => {
      // 1 ETH at $3200 = ~$3,200
      expect(usdSuffix(1000000000000000000n, 18, 3200)).toBe(" (~$3,200)");
    });

    test("handles zero amount", () => {
      expect(usdSuffix(0n, 18, 3200)).toBe(" (~$0)");
    });

    test("returns empty string for non-finite result", () => {
      expect(usdSuffix(1000000000000000000n, 18, Infinity)).toBe("");
    });
  });
});
