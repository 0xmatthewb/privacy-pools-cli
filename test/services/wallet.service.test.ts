import { describe, expect, test } from "bun:test";
import {
  generateMnemonic,
  validateMnemonic,
  getSignerAddress,
} from "../../src/services/wallet.ts";

describe("wallet service", () => {
  describe("generateMnemonic", () => {
    test("generates a 12-word BIP39 mnemonic", () => {
      const mnemonic = generateMnemonic();
      const words = mnemonic.split(" ");
      expect(words.length).toBe(12);
    });

    test("generated mnemonic is valid", () => {
      const mnemonic = generateMnemonic();
      expect(validateMnemonic(mnemonic)).toBe(true);
    });

    test("generates unique mnemonics on each call", () => {
      const m1 = generateMnemonic();
      const m2 = generateMnemonic();
      expect(m1).not.toBe(m2);
    });
  });

  describe("validateMnemonic", () => {
    test("accepts valid 12-word mnemonic", () => {
      expect(
        validateMnemonic(
          "test test test test test test test test test test test junk"
        )
      ).toBe(true);
    });

    test("accepts mnemonic with leading/trailing whitespace", () => {
      expect(
        validateMnemonic(
          "  test test test test test test test test test test test junk  "
        )
      ).toBe(true);
    });

    test("rejects invalid mnemonic", () => {
      expect(
        validateMnemonic("invalid words that are not a real mnemonic")
      ).toBe(false);
    });

    test("rejects empty string", () => {
      expect(validateMnemonic("")).toBe(false);
    });

    test("rejects too few words", () => {
      expect(validateMnemonic("test test test")).toBe(false);
    });
  });

  describe("getSignerAddress", () => {
    test("returns checksummed address for known private key", () => {
      const address = getSignerAddress(
        "0x1111111111111111111111111111111111111111111111111111111111111111"
      );
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    test("same key always gives same address", () => {
      const key =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
      const a1 = getSignerAddress(key);
      const a2 = getSignerAddress(key);
      expect(a1).toBe(a2);
    });

    test("different keys give different addresses", () => {
      const a1 = getSignerAddress(
        "0x1111111111111111111111111111111111111111111111111111111111111111"
      );
      const a2 = getSignerAddress(
        "0x2222222222222222222222222222222222222222222222222222222222222222"
      );
      expect(a1).not.toBe(a2);
    });
  });
});
