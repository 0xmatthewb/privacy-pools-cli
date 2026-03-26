/**
 * Integration tests for --mnemonic-file with structured backup files.
 *
 * Verifies that `init --mnemonic-file` correctly imports mnemonics from:
 *   1. Raw mnemonic files (website Welcome.tsx download)
 *   2. CLI backup files (privacy-pools-recovery.txt)
 *   3. Website structured recovery files (Menu.tsx / CreateHistoryFile.tsx)
 *   4. Files with no valid mnemonic (should fail gracefully)
 */
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TEST_MNEMONIC,
  createTempHome,
  parseJsonOutput,
  runCli,
  writeTestSecretFiles,
} from "../helpers/cli.ts";

function writeTempFile(home: string, filename: string, content: string): string {
  const filePath = join(home, filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function runMnemonicFileInit(home: string, filePath: string) {
  const { privateKeyPath } = writeTestSecretFiles(home);
  return runCli(
    [
      "--json",
      "init",
      "--mnemonic-file",
      filePath,
      "--private-key-file",
      privateKeyPath,
      "--default-chain",
      "sepolia",
      "--yes",
    ],
    { home, timeoutMs: 60_000 },
  );
}

describe("init --mnemonic-file with structured backup files", () => {
  test("fails for valid BIP-39 mnemonics with unsupported word counts", () => {
    const home = createTempHome();
    const filePath = writeTempFile(
      home,
      "valid-15-word.txt",
      "morning world loop ankle vehicle coach cradle curious image position write tuition enemy permit bone",
    );

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).not.toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(false);
    expect((json as any).errorMessage).toContain("No valid recovery phrase found");
  });


  // ── Raw mnemonic (baseline, website Welcome.tsx format) ────────────────

  test("imports raw mnemonic file", () => {
    const home = createTempHome();
    const filePath = writeTempFile(home, "raw.txt", TEST_MNEMONIC);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(true);
  });

  // ── CLI backup format ─────────────────────────────────────────────────

  test("imports CLI backup file (privacy-pools-recovery.txt format)", () => {
    const home = createTempHome();
    const cliBackup = [
      "Privacy Pools Recovery Phrase",
      "",
      "Recovery Phrase:",
      TEST_MNEMONIC,
      "",
      "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
      "Anyone with this phrase can access your Privacy Pools deposits.",
    ].join("\n");
    const filePath = writeTempFile(home, "cli-backup.txt", cliBackup);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(true);
  });

  // ── Website Menu.tsx format ───────────────────────────────────────────

  test("imports website Menu.tsx recovery file", () => {
    const home = createTempHome();
    const websiteBackup = [
      "Privacy Pools Recovery Phrase",
      "",
      "Wallet Address: 0xAbC12f3456789abcDEF0123456789aBcDeF01234",
      "",
      "Recovery Phrase:",
      TEST_MNEMONIC,
      "",
      "IMPORTANT: Keep this file secure and never share it with anyone.",
      "This phrase is the ONLY way to recover your account if you lose access.",
    ].join("\n");
    const filePath = writeTempFile(home, "website-menu-backup.txt", websiteBackup);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(true);
  });

  // ── Website CreateHistoryFile.tsx format ───────────────────────────────

  test("imports website CreateHistoryFile.tsx recovery file", () => {
    const home = createTempHome();
    const createHistoryBackup = [
      "Privacy Pools Recovery Phrase",
      "",
      "Wallet Address: 0xAbC12f3456789abcDEF0123456789aBcDeF01234",
      "",
      "Recovery Phrase:",
      TEST_MNEMONIC,
      "",
      "IMPORTANT: Keep this file secure and never share it with anyone.",
      "This phrase is the ONLY way to recover your account if you lose your wallet private key.",
    ].join("\n");
    const filePath = writeTempFile(home, "website-create-backup.txt", createHistoryBackup);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(true);
  });

  // ── Failure: no valid mnemonic in file ────────────────────────────────

  test("fails gracefully for file with no valid mnemonic", () => {
    const home = createTempHome();
    const badContent = [
      "Privacy Pools Recovery Phrase",
      "",
      "Recovery Phrase:",
      "this is not a valid mnemonic phrase at all",
      "",
      "IMPORTANT: Keep this file secure.",
    ].join("\n");
    const filePath = writeTempFile(home, "bad-backup.txt", badContent);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).not.toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(false);
    expect((json as any).errorMessage).toContain("No valid recovery phrase found");
  });

  // ── Failure: empty file ───────────────────────────────────────────────

  test("fails gracefully for empty file", () => {
    const home = createTempHome();
    const filePath = writeTempFile(home, "empty.txt", "");

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).not.toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(false);
  });

  // ── Failure: ambiguous file (multiple valid mnemonics) ──────────────────

  test("fails safely for file containing multiple valid mnemonics", () => {
    const home = createTempHome();
    const ambiguous = [
      TEST_MNEMONIC,
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    ].join("\n");
    const filePath = writeTempFile(home, "ambiguous.txt", ambiguous);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).not.toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(false);
    expect((json as any).errorMessage).toContain("Multiple valid recovery phrases found");
  });

  // ── Mnemonic is not leaked in JSON output ─────────────────────────────

  test("mnemonic from structured file is not leaked in JSON output", () => {
    const home = createTempHome();
    const cliBackup = [
      "Privacy Pools Recovery Phrase",
      "",
      "Recovery Phrase:",
      TEST_MNEMONIC,
      "",
      "IMPORTANT: Keep this file secure.",
    ].join("\n");
    const filePath = writeTempFile(home, "cli-backup.txt", cliBackup);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).toBe(0);
    // Mnemonic should NOT appear in stdout JSON (same security as --mnemonic flag)
    expect(result.stdout).not.toContain(TEST_MNEMONIC);
  });

  // ── Windows line endings ──────────────────────────────────────────────

  test("imports CLI backup file with Windows line endings", () => {
    const home = createTempHome();
    const cliBackup = [
      "Privacy Pools Recovery Phrase",
      "",
      "Recovery Phrase:",
      TEST_MNEMONIC,
      "",
      "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
      "Anyone with this phrase can access your Privacy Pools deposits.",
    ].join("\r\n");
    const filePath = writeTempFile(home, "windows-backup.txt", cliBackup);

    const result = runMnemonicFileInit(home, filePath);
    expect(result.status).toBe(0);
    const json = parseJsonOutput(result.stdout);
    expect((json as any).success).toBe(true);
  });
});
