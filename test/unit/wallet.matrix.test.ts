import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  generateMnemonic,
  getMasterKeys,
  getSignerAddress,
  validateMnemonic,
} from "../../src/services/wallet.ts";

describe("wallet matrix", () => {
  test("generateMnemonic emits a valid mnemonic", () => {
    const mnemonic = generateMnemonic();
    expect(validateMnemonic(mnemonic)).toBe(true);
    const words = mnemonic.trim().split(/\s+/g);
    expect(words.length === 12 || words.length === 24).toBe(true);
  });

  const VALID_MNEMONICS = [
    "test test test test test test test test test test test junk",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    "legal winner thank year wave sausage worth useful legal winner thank yellow",
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
  ];

  for (const mnemonic of VALID_MNEMONICS) {
    test(`validateMnemonic accepts known phrase: ${mnemonic.split(" ")[0]}...`, () => {
      expect(validateMnemonic(mnemonic)).toBe(true);
    });
  }

  const INVALID_MNEMONICS = [
    "",
    "test",
    "this is not a bip39 mnemonic",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon",
    "test test test test test test test test test test test test",
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo",
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon",
    "legal winner thank year wave sausage worth useful legal winner thank",
    "0 1 2 3 4 5 6 7 8 9 10 11",
    "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll",
  ];

  for (const mnemonic of INVALID_MNEMONICS) {
    test(`validateMnemonic rejects invalid phrase: '${mnemonic || "<empty>"}'`, () => {
      expect(validateMnemonic(mnemonic)).toBe(false);
    });
  }

  const PRIVATE_KEYS = [
    "0x1111111111111111111111111111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444444444444444444444444444",
    "0x5555555555555555555555555555555555555555555555555555555555555555",
  ] as const;

  for (const key of PRIVATE_KEYS) {
    test(`getSignerAddress matches viem privateKeyToAccount for ${key.slice(0, 10)}...`, () => {
      expect(getSignerAddress(key)).toBe(privateKeyToAccount(key).address);
    });
  }

  const MASTER_KEY_CASES = [
    VALID_MNEMONICS[0],
    VALID_MNEMONICS[1],
    VALID_MNEMONICS[2],
  ];

  for (const mnemonic of MASTER_KEY_CASES) {
    test(`getMasterKeys deterministic for ${mnemonic.split(" ")[0]}...`, () => {
      const a = getMasterKeys(mnemonic);
      const b = getMasterKeys(mnemonic);
      expect(a.masterNullifier).toBe(b.masterNullifier);
      expect(a.masterSecret).toBe(b.masterSecret);
      expect(typeof a.masterNullifier).toBe("bigint");
      expect(typeof a.masterSecret).toBe("bigint");
    });
  }

  test("getMasterKeys differs across different mnemonics", () => {
    const a = getMasterKeys(VALID_MNEMONICS[0]);
    const b = getMasterKeys(VALID_MNEMONICS[1]);
    expect(a.masterNullifier === b.masterNullifier).toBe(false);
    expect(a.masterSecret === b.masterSecret).toBe(false);
  });
});
