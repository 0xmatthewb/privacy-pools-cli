/**
 * Behavioral mnemonic security test.
 *
 * Verifies that secret material (mnemonic, private key) never leaks
 * into standard JSON output. The mnemonic should only appear when
 * explicitly requested via --show-recovery-phrase.
 */
import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

describe("mnemonic security", () => {
  test("init --json output does not contain the mnemonic phrase", () => {
    const home = createTempHome();
    const backupFile = `${home}/recovery.txt`;
    const result = runCli(
      [
        "--json", "init",
        "--backup-file", backupFile,
        "--private-key", TEST_PRIVATE_KEY,
        "--default-chain", "sepolia",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );
    expect(result.status).toBe(0);
    // The mnemonic should NOT appear in stdout JSON
    expect(result.stdout).not.toContain(TEST_MNEMONIC);
    // The private key should NOT appear in stdout
    expect(result.stdout).not.toContain(TEST_PRIVATE_KEY);
  });

  test("status --json output does not leak mnemonic or private key", () => {
    const home = createTempHome();
    const backupFile = `${home}/recovery.txt`;
    runCli(
      [
        "--json", "init",
        "--backup-file", backupFile,
        "--private-key", TEST_PRIVATE_KEY,
        "--default-chain", "sepolia",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );

    const status = runCli(["--json", "status"], { home, timeoutMs: 10_000 });
    expect(status.status).toBe(0);
    expect(status.stdout).not.toContain(TEST_MNEMONIC);
    expect(status.stdout).not.toContain(TEST_PRIVATE_KEY);
    // stderr should also be clean
    expect(status.stderr).not.toContain(TEST_MNEMONIC);
    expect(status.stderr).not.toContain(TEST_PRIVATE_KEY);
  });

  test("status human-mode output does not leak mnemonic or private key", () => {
    const home = createTempHome();
    const backupFile = `${home}/recovery.txt`;
    runCli(
      [
        "--json", "init",
        "--backup-file", backupFile,
        "--private-key", TEST_PRIVATE_KEY,
        "--default-chain", "sepolia",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );

    const status = runCli(["status"], { home, timeoutMs: 10_000 });
    expect(status.status).toBe(0);
    const combined = status.stdout + status.stderr;
    expect(combined).not.toContain(TEST_MNEMONIC);
    expect(combined).not.toContain(TEST_PRIVATE_KEY);
  });

  test("error output does not leak mnemonic even when mnemonic is invalid", () => {
    const home = createTempHome();
    const result = runCli(
      [
        "--json", "init",
        "--recovery-phrase", "not a valid mnemonic phrase at all",
        "--private-key", TEST_PRIVATE_KEY,
        "--default-chain", "sepolia",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );
    // Should fail but not echo the bad mnemonic in output
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain("not a valid mnemonic phrase at all");
  });
});
