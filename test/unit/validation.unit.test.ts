import { describe, expect, test } from "bun:test";
import {
  parseAmount,
  resolveChain,
  validateAddress,
  validatePositive,
} from "../../src/utils/validation.ts";
import { CLIError } from "../../src/utils/errors.ts";

describe("validation utils", () => {
  test("resolveChain resolves supported chains", () => {
    expect(resolveChain("ethereum").id).toBe(1);
    expect(resolveChain("arbitrum").id).toBe(42161);
    expect(resolveChain("optimism").id).toBe(10);
    expect(resolveChain("sepolia").id).toBe(11155111);
    expect(resolveChain("op-sepolia").id).toBe(11155420);
  });

  test("resolveChain throws for unknown chain", () => {
    expect(() => resolveChain("unknown-chain")).toThrow(CLIError);
  });

  test("validateAddress accepts valid EVM address", () => {
    expect(validateAddress("0x0000000000000000000000000000000000000000")).toBe(
      "0x0000000000000000000000000000000000000000"
    );
  });

  test("validateAddress rejects invalid address", () => {
    expect(() => validateAddress("0x1234")).toThrow(CLIError);
  });

  test("parseAmount parses decimal strings", () => {
    expect(parseAmount("1.23", 2)).toBe(123n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
  });

  test("parseAmount rejects invalid numeric strings", () => {
    expect(() => parseAmount("abc", 18)).toThrow(CLIError);
    expect(() => parseAmount("1.2.3", 18)).toThrow(CLIError);
  });

  test("validatePositive rejects zero and negative-like values", () => {
    expect(() => validatePositive(0n)).toThrow(CLIError);
    expect(() => validatePositive(-1n)).toThrow(CLIError);
    expect(() => validatePositive(1n)).not.toThrow();
  });
});
