import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  formatAddress,
  formatAmount,
  formatBPS,
  formatTxHash,
  info,
  printTable,
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

  test("printTable json mode emits JSON array keyed by headers", () => {
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    };

    printTable(
      ["Asset", "Balance"],
      [
        ["ETH", "1"],
        ["USDC", "10"],
      ],
      { json: true }
    );

    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]) as Array<Record<string, string>>;
    expect(parsed).toEqual([
      { Asset: "ETH", Balance: "1" },
      { Asset: "USDC", Balance: "10" },
    ]);
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

    expect(logs.some((l) => l.includes("✓") && l.includes("ok"))).toBe(true);
    expect(logs.some((l) => l.includes("⚠") && l.includes("careful"))).toBe(true);
    expect(logs.some((l) => l.includes("ℹ") && l.includes("heads-up"))).toBe(true);
    expect(logs.some((l) => l.includes("quiet"))).toBe(false);
    expect(logs.some((l) => l.includes("noisy"))).toBe(true);
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
});
