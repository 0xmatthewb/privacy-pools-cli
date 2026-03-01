import { describe, expect, test } from "bun:test";
import { parseAmount, resolveChain, validateAddress, validatePositive } from "../../src/utils/validation.ts";
import { CLIError } from "../../src/utils/errors.ts";

const VALID_PARSE_CASES: Array<{ input: string; decimals: number; expected: bigint }> = [
  { input: "0", decimals: 18, expected: 0n },
  { input: "1", decimals: 18, expected: 1000000000000000000n },
  { input: "0.1", decimals: 18, expected: 100000000000000000n },
  { input: "0.01", decimals: 18, expected: 10000000000000000n },
  { input: "0.001", decimals: 18, expected: 1000000000000000n },
  { input: "1.23", decimals: 2, expected: 123n },
  { input: "1.230000", decimals: 6, expected: 1230000n },
  { input: "1234.567890", decimals: 6, expected: 1234567890n },
  { input: "999999", decimals: 0, expected: 999999n },
  { input: "0.000001", decimals: 6, expected: 1n },
  { input: "1000000", decimals: 6, expected: 1000000000000n },
  { input: "42.42", decimals: 2, expected: 4242n },
  { input: "10.000000000000000001", decimals: 18, expected: 10000000000000000001n },
  { input: "314159.2653", decimals: 4, expected: 3141592653n },
  { input: "2718.2818", decimals: 4, expected: 27182818n },
  { input: "0.5", decimals: 1, expected: 5n },
  { input: "77.7", decimals: 1, expected: 777n },
  { input: "123456789.123456", decimals: 6, expected: 123456789123456n },
  { input: "0.000000000000000001", decimals: 18, expected: 1n },
  { input: "2.5", decimals: 18, expected: 2500000000000000000n },
];

const INVALID_PARSE_CASES: Array<{ input: string; decimals: number }> = [
  { input: "abc", decimals: 18 },
  { input: "1..2", decimals: 18 },
  { input: "", decimals: 18 },
  { input: " ", decimals: 18 },
  { input: "1,23", decimals: 18 },
  { input: "1e18", decimals: 18 },
  { input: "-1", decimals: 18 },
  { input: "--1", decimals: 18 },
  { input: ".", decimals: 18 },
  { input: "..", decimals: 18 },
  { input: "1.2.3", decimals: 18 },
  { input: "0x10", decimals: 18 },
  { input: "ten", decimals: 18 },
  { input: "1/2", decimals: 18 },
  { input: "∞", decimals: 18 },
  { input: "NaN", decimals: 18 },
  { input: "1_000", decimals: 18 },
  { input: "++3", decimals: 18 },
  { input: "-0.1", decimals: 18 },
  { input: "1.-2", decimals: 18 },
  { input: "0.0000001", decimals: 6 },
  { input: "2.345", decimals: 2 },
  { input: "123.4567", decimals: 3 },
  { input: "999.9999", decimals: 3 },
  { input: "0.1234567", decimals: 6 },
];

const VALID_ADDRESSES = [
  "0x0000000000000000000000000000000000000000",
  "0x1111111111111111111111111111111111111111",
  "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "0x6818809eefce719e480a7526d76bd3e561526b46",
  "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
  "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
  "0x54aca0d27500669fa37867233e05423701f11ba1",
  "0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB",
];

const INVALID_ADDRESSES = [
  "",
  "0x",
  "0x1234",
  "123456",
  "not-an-address",
  "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "0x000000000000000000000000000000000000000",
  "0x00000000000000000000000000000000000000000",
  "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A11",
  "19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
];

describe("validation matrix", () => {
  const CHAIN_CASES = [
    ["ethereum", 1],
    ["mainnet", 1],
    ["arbitrum", 42161],
    ["optimism", 10],
    ["sepolia", 11155111],
    ["op-sepolia", 11155420],
  ] as const;

  for (const [name, id] of CHAIN_CASES) {
    test(`resolveChain(${name}) -> chain id ${id}`, () => {
      expect(resolveChain(name).id).toBe(id);
    });
  }

  const UNKNOWN_CHAIN_CASES = [
    "",
    "eth",
    "arbitrum-one",
    "optimism-mainnet",
    "op_sepolia",
    "solana",
    "polygon",
    "base",
    "testnet",
  ];

  for (const name of UNKNOWN_CHAIN_CASES) {
    test(`resolveChain rejects unknown chain '${name || "<empty>"}'`, () => {
      expect(() => resolveChain(name)).toThrow(CLIError);
    });
  }

  for (const c of VALID_PARSE_CASES) {
    test(`parseAmount('${c.input}', ${c.decimals})`, () => {
      expect(parseAmount(c.input, c.decimals)).toBe(c.expected);
    });
  }

  for (const c of INVALID_PARSE_CASES) {
    test(`parseAmount rejects '${c.input}' at ${c.decimals} decimals`, () => {
      expect(() => parseAmount(c.input, c.decimals)).toThrow(CLIError);
    });
  }

  for (const address of VALID_ADDRESSES) {
    test(`validateAddress accepts ${address}`, () => {
      expect(validateAddress(address)).toBe(address);
    });
  }

  for (const address of INVALID_ADDRESSES) {
    test(`validateAddress rejects '${address || "<empty>"}'`, () => {
      expect(() => validateAddress(address)).toThrow(CLIError);
    });
  }

  test("validatePositive rejects zero and negative-like values", () => {
    expect(() => validatePositive(0n)).toThrow(CLIError);
    expect(() => validatePositive(-1n)).toThrow(CLIError);
    expect(() => validatePositive(1n)).not.toThrow();
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
});
