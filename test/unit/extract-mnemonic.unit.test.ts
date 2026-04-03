/**
 * Unit tests for extractMnemonicFromFile().
 *
 * Covers every known backup file format (CLI, website Welcome, website Menu,
 * website CreateHistoryFile) plus edge cases and adversarial inputs.
 */
import { describe, expect, test } from "bun:test";
import {
  extractMnemonicFromFile,
  extractMnemonicFromFileDetailed,
  validateMnemonic,
} from "../../src/services/wallet.ts";

const VALID_12 = "test test test test test test test test test test test junk";
const VALID_24 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

// ─── Sanity: our test mnemonics are actually valid ──────────────────────────

describe("test fixture sanity", () => {
  test("VALID_12 is a valid 12-word mnemonic", () => {
    expect(validateMnemonic(VALID_12)).toBe(true);
  });
  test("VALID_24 is a valid 24-word mnemonic", () => {
    expect(validateMnemonic(VALID_24)).toBe(true);
  });
});

// ─── Format 1: Raw mnemonic (website Welcome.tsx download) ──────────────────

describe("raw mnemonic files", () => {
  test("extracts 12-word raw mnemonic", () => {
    expect(extractMnemonicFromFile(VALID_12)).toBe(VALID_12);
  });

  test("extracts 24-word raw mnemonic", () => {
    expect(extractMnemonicFromFile(VALID_24)).toBe(VALID_24);
  });

  test("handles leading/trailing whitespace", () => {
    expect(extractMnemonicFromFile(`  ${VALID_12}  `)).toBe(VALID_12);
  });

  test("handles leading/trailing newlines", () => {
    expect(extractMnemonicFromFile(`\n\n${VALID_12}\n\n`)).toBe(VALID_12);
  });

  test("handles Windows-style line endings around raw mnemonic", () => {
    expect(extractMnemonicFromFile(`\r\n${VALID_12}\r\n`)).toBe(VALID_12);
  });
});

// ─── Format 2: CLI backup file ──────────────────────────────────────────────

describe("CLI backup file format", () => {
  const cliBackup = [
    "Privacy Pools Recovery Phrase",
    "",
    "Recovery Phrase:",
    VALID_12,
    "",
    "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
    "Anyone with this phrase can access your Privacy Pools deposits.",
  ].join("\n");

  test("extracts mnemonic from CLI backup format", () => {
    expect(extractMnemonicFromFile(cliBackup)).toBe(VALID_12);
  });

  test("extracts 24-word mnemonic from CLI backup format", () => {
    const cliBackup24 = cliBackup.replace(VALID_12, VALID_24);
    expect(extractMnemonicFromFile(cliBackup24)).toBe(VALID_24);
  });

  test("handles CLI backup with Windows line endings", () => {
    const windowsBackup = cliBackup.replace(/\n/g, "\r\n");
    expect(extractMnemonicFromFile(windowsBackup)).toBe(VALID_12);
  });
});

// ─── Format 3: Website Menu.tsx / CreateHistoryFile.tsx download ─────────────

describe("website structured backup format", () => {
  const websiteBackup = [
    "Privacy Pools Recovery Phrase",
    "",
    "Wallet Address: 0xAbC12f3456789abcDEF0123456789aBcDeF01234",
    "",
    "Recovery Phrase:",
    VALID_12,
    "",
    "IMPORTANT: Keep this file secure and never share it with anyone.",
    "This phrase is the ONLY way to recover your account if you lose access.",
  ].join("\n");

  test("extracts mnemonic from website Menu.tsx format", () => {
    expect(extractMnemonicFromFile(websiteBackup)).toBe(VALID_12);
  });

  test("extracts 24-word mnemonic from website format", () => {
    const websiteBackup24 = websiteBackup.replace(VALID_12, VALID_24);
    expect(extractMnemonicFromFile(websiteBackup24)).toBe(VALID_24);
  });

  // CreateHistoryFile.tsx uses a slightly different final warning
  const createHistoryBackup = [
    "Privacy Pools Recovery Phrase",
    "",
    "Wallet Address: 0xAbC12f3456789abcDEF0123456789aBcDeF01234",
    "",
    "Recovery Phrase:",
    VALID_12,
    "",
    "IMPORTANT: Keep this file secure and never share it with anyone.",
    "This phrase is the ONLY way to recover your account if you lose your wallet private key.",
  ].join("\n");

  test("extracts mnemonic from website CreateHistoryFile.tsx format", () => {
    expect(extractMnemonicFromFile(createHistoryBackup)).toBe(VALID_12);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  test("returns null for empty string", () => {
    expect(extractMnemonicFromFile("")).toBeNull();
  });

  test("returns null for whitespace-only content", () => {
    expect(extractMnemonicFromFile("   \n\n  \n  ")).toBeNull();
  });

  test("returns null for file with no valid mnemonic", () => {
    const noMnemonic = [
      "Privacy Pools Recovery Phrase",
      "",
      "Recovery Phrase:",
      "this is not a valid mnemonic phrase at all",
      "",
      "IMPORTANT: Keep this file secure.",
    ].join("\n");
    expect(extractMnemonicFromFile(noMnemonic)).toBeNull();
  });

  test("returns null for random prose", () => {
    expect(extractMnemonicFromFile(
      "This is just a random text file that someone might accidentally point the CLI at."
    )).toBeNull();
  });

  test("returns null when file contains multiple different valid mnemonics", () => {
    // Two distinct valid mnemonics on separate lines = ambiguous
    const twoMnemonics = [
      VALID_12,
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    ].join("\n");
    expect(extractMnemonicFromFile(twoMnemonics)).toBeNull();
  });

  test("returns null when same mnemonic appears on two lines", () => {
    // Even identical mnemonics on separate lines are treated as ambiguous.
    // This is conservative by design — a valid backup file will always
    // contain the mnemonic exactly once.
    const duplicated = [VALID_12, VALID_12].join("\n");
    expect(extractMnemonicFromFile(duplicated)).toBeNull();
  });

  test("handles mnemonic with extra internal whitespace (normalizes)", () => {
    // validateMnemonic already trims, but let's verify the line-scan path
    const extraSpaces = [
      "Privacy Pools Recovery Phrase",
      "",
      "Recovery Phrase:",
      "  test  test  test  test  test  test  test  test  test  test  test  junk  ",
      "",
    ].join("\n");
    // The mnemonic with extra spaces between words should still be found
    // because validateMnemonic does .trim() internally, but BIP-39 validation
    // itself uses the wordlist to check each word. Multiple spaces between
    // words might cause split differences — let's verify the behavior is safe.
    const result = extractMnemonicFromFile(extraSpaces);
    // bip39ValidateMnemonic normalizes via .trim() only, not internal spaces.
    // This depends on the BIP-39 library behavior — the test documents reality.
    if (result !== null) {
      expect(validateMnemonic(result)).toBe(true);
    }
    // Either way, we should never return an invalid mnemonic
  });
});

// ─── Security: never return garbage ─────────────────────────────────────────

describe("security invariants", () => {
  test("returned value is always a valid mnemonic or null", () => {
    const testCases = [
      "",
      "hello",
      VALID_12,
      VALID_24,
      `header\n${VALID_12}\nfooter`,
      `${VALID_12}\n${VALID_12}`, // same mnemonic twice — returns null (tested explicitly above)
      "not a mnemonic\nnot a mnemonic either\n",
    ];
    for (const content of testCases) {
      const result = extractMnemonicFromFile(content);
      if (result !== null) {
        expect(validateMnemonic(result)).toBe(true);
      }
    }
  });

  test("never returns a substring of a non-mnemonic line", () => {
    // A line that contains 12+ words but isn't a valid mnemonic
    const fakeContent = [
      "This sentence has twelve words and is definitely not a real mnemonic phrase at all",
      VALID_12,
    ].join("\n");
    const result = extractMnemonicFromFile(fakeContent);
    expect(result).toBe(VALID_12);
  });
});

describe("detailed extraction result", () => {
  test("returns failure=none_found when no mnemonic exists", () => {
    const result = extractMnemonicFromFileDetailed("definitely not a mnemonic file");
    expect(result.mnemonic).toBeNull();
    expect(result.failure).toBe("none_found");
  });

  test("returns failure=multiple_found when file is ambiguous", () => {
    const result = extractMnemonicFromFileDetailed(
      `${VALID_12}\nabandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`
    );
    expect(result.mnemonic).toBeNull();
    expect(result.failure).toBe("multiple_found");
  });
});
