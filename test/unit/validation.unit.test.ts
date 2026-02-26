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

  test("resolveChain applies host overrides from environment", () => {
    const prevGlobalAsp = process.env.PRIVACY_POOLS_ASP_HOST;
    const prevChainAsp = process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA;
    const prevGlobalRelayer = process.env.PRIVACY_POOLS_RELAYER_HOST;
    const prevChainRelayer = process.env.PRIVACY_POOLS_RELAYER_HOST_SEPOLIA;
    try {
      process.env.PRIVACY_POOLS_ASP_HOST = "https://asp-global.test";
      process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA = "https://asp-sepolia.test";
      process.env.PRIVACY_POOLS_RELAYER_HOST = "https://relayer-global.test";
      process.env.PRIVACY_POOLS_RELAYER_HOST_SEPOLIA =
        "https://relayer-sepolia.test";

      const sepolia = resolveChain("sepolia");
      expect(sepolia.aspHost).toBe("https://asp-sepolia.test");
      expect(sepolia.relayerHost).toBe("https://relayer-sepolia.test");

      const ethereum = resolveChain("ethereum");
      expect(ethereum.aspHost).toBe("https://asp-global.test");
      expect(ethereum.relayerHost).toBe("https://relayer-global.test");
    } finally {
      if (prevGlobalAsp === undefined) delete process.env.PRIVACY_POOLS_ASP_HOST;
      else process.env.PRIVACY_POOLS_ASP_HOST = prevGlobalAsp;
      if (prevChainAsp === undefined) delete process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA;
      else process.env.PRIVACY_POOLS_ASP_HOST_SEPOLIA = prevChainAsp;
      if (prevGlobalRelayer === undefined) delete process.env.PRIVACY_POOLS_RELAYER_HOST;
      else process.env.PRIVACY_POOLS_RELAYER_HOST = prevGlobalRelayer;
      if (prevChainRelayer === undefined) delete process.env.PRIVACY_POOLS_RELAYER_HOST_SEPOLIA;
      else process.env.PRIVACY_POOLS_RELAYER_HOST_SEPOLIA = prevChainRelayer;
    }
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
