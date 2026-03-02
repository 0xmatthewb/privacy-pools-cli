import { describe, expect, test } from "bun:test";
import {
  generateMnemonic,
  validateMnemonic,
  getSignerAddress,
  getMasterKeys,
  loadMnemonic,
  loadPrivateKey,
} from "../../src/services/wallet.ts";
import { CLIError } from "../../src/utils/errors.ts";

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

  describe("getMasterKeys", () => {
    test("returns object with masterNullifier and masterSecret fields", () => {
      const mnemonic = "test test test test test test test test test test test junk";
      const keys = getMasterKeys(mnemonic);
      expect(keys).toBeDefined();
      expect(keys).toHaveProperty("masterNullifier");
      expect(keys).toHaveProperty("masterSecret");
    });

    test("same mnemonic produces same keys", () => {
      const mnemonic = "test test test test test test test test test test test junk";
      const k1 = getMasterKeys(mnemonic);
      const k2 = getMasterKeys(mnemonic);
      expect(k1).toEqual(k2);
    });

    test("different mnemonics produce different keys", () => {
      const m1 = "test test test test test test test test test test test junk";
      const m2 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
      const k1 = getMasterKeys(m1);
      const k2 = getMasterKeys(m2);
      expect(k1.masterNullifier).not.toEqual(k2.masterNullifier);
      expect(k1.masterSecret).not.toEqual(k2.masterSecret);
    });
  });

  describe("loadMnemonic", () => {
    test("throws CLIError with INPUT category when no mnemonic file exists", () => {
      // With a fresh temp PRIVACY_POOLS_HOME, there's no mnemonic file
      const origHome = process.env.PRIVACY_POOLS_HOME;
      const { mkdtempSync } = require("node:fs");
      const { join } = require("node:path");
      const { tmpdir } = require("node:os");
      const tempDir = mkdtempSync(join(tmpdir(), "pp-wallet-test-"));
      process.env.PRIVACY_POOLS_HOME = tempDir;
      try {
        expect(() => loadMnemonic()).toThrow(CLIError);
        try {
          loadMnemonic();
        } catch (err) {
          expect(err).toBeInstanceOf(CLIError);
          expect((err as CLIError).category).toBe("INPUT");
        }
      } finally {
        if (origHome !== undefined) {
          process.env.PRIVACY_POOLS_HOME = origHome;
        } else {
          delete process.env.PRIVACY_POOLS_HOME;
        }
      }
    });
  });

  describe("loadPrivateKey", () => {
    test("throws CLIError with INPUT category when no signer file exists", () => {
      const origHome = process.env.PRIVACY_POOLS_HOME;
      const origKey = process.env.PRIVACY_POOLS_PRIVATE_KEY;
      const { mkdtempSync } = require("node:fs");
      const { join } = require("node:path");
      const { tmpdir } = require("node:os");
      const tempDir = mkdtempSync(join(tmpdir(), "pp-wallet-test-"));
      process.env.PRIVACY_POOLS_HOME = tempDir;
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
      try {
        expect(() => loadPrivateKey()).toThrow(CLIError);
        try {
          loadPrivateKey();
        } catch (err) {
          expect(err).toBeInstanceOf(CLIError);
          expect((err as CLIError).category).toBe("INPUT");
        }
      } finally {
        if (origHome !== undefined) {
          process.env.PRIVACY_POOLS_HOME = origHome;
        } else {
          delete process.env.PRIVACY_POOLS_HOME;
        }
        if (origKey !== undefined) {
          process.env.PRIVACY_POOLS_PRIVATE_KEY = origKey;
        }
      }
    });
  });
});
