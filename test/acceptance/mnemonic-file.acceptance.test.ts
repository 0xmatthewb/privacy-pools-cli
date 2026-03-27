import { expect } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { TEST_MNEMONIC, writeTestSecretFiles } from "../helpers/cli.ts";
import {
  assertExit,
  assertJson,
  assertStdout,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
} from "./framework.ts";

function writeTempFile(home: string, filename: string, content: string): string {
  const filePath = join(home, filename);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

function initArgs(home: string, filePath: string): string[] {
  const { privateKeyPath } = writeTestSecretFiles(home);
  return [
    "--json",
    "init",
    "--mnemonic-file",
    filePath,
    "--private-key-file",
    privateKeyPath,
    "--default-chain",
    "sepolia",
    "--yes",
  ];
}

defineScenarioSuite("mnemonic-file acceptance", [
  defineScenario("fails for valid BIP-39 mnemonics with unsupported word counts", [
    (ctx) => {
      const filePath = writeTempFile(
        ctx.home,
        "valid-15-word.txt",
        "morning world loop ankle vehicle coach cradle curious image position write tuition enemy permit bone",
      );
      return runCliStep(initArgs(ctx.home, filePath), { timeoutMs: 60_000 })(ctx);
    },
    assertExit(2),
    assertJson<{ success: boolean; errorMessage: string }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorMessage).toContain("No valid recovery phrase found");
    }),
  ]),
  defineScenario("imports a raw mnemonic file", [
    (ctx) => runCliStep(initArgs(ctx.home, writeTempFile(ctx.home, "raw.txt", TEST_MNEMONIC)), {
      timeoutMs: 60_000,
    })(ctx),
    assertExit(0),
    assertJson<{ success: boolean }>((json) => {
      expect(json.success).toBe(true);
    }),
  ]),
  defineScenario("imports a CLI backup file", [
    (ctx) => {
      const cliBackup = [
        "Privacy Pools Recovery Phrase",
        "",
        "Recovery Phrase:",
        TEST_MNEMONIC,
        "",
        "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
        "Anyone with this phrase can access your Privacy Pools deposits.",
      ].join("\n");
      return runCliStep(initArgs(ctx.home, writeTempFile(ctx.home, "cli-backup.txt", cliBackup)), {
        timeoutMs: 60_000,
      })(ctx);
    },
    assertExit(0),
    assertJson<{ success: boolean }>((json) => {
      expect(json.success).toBe(true);
    }),
  ]),
  defineScenario("imports website structured recovery files", [
    (ctx) => {
      const structured = [
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
      return runCliStep(
        initArgs(ctx.home, writeTempFile(ctx.home, "website-backup.txt", structured)),
        { timeoutMs: 60_000 },
      )(ctx);
    },
    assertExit(0),
    assertJson<{ success: boolean }>((json) => {
      expect(json.success).toBe(true);
    }),
  ]),
  defineScenario("fails gracefully for file with no valid mnemonic", [
    (ctx) => {
      const badContent = [
        "Privacy Pools Recovery Phrase",
        "",
        "Recovery Phrase:",
        "this is not a valid mnemonic phrase at all",
        "",
        "IMPORTANT: Keep this file secure.",
      ].join("\n");
      return runCliStep(
        initArgs(ctx.home, writeTempFile(ctx.home, "bad-backup.txt", badContent)),
        { timeoutMs: 60_000 },
      )(ctx);
    },
    assertExit(2),
    assertJson<{ success: boolean; errorMessage: string }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorMessage).toContain("No valid recovery phrase found");
    }),
  ]),
  defineScenario("fails safely for files with multiple valid mnemonics", [
    (ctx) => {
      const ambiguous = [
        TEST_MNEMONIC,
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      ].join("\n");
      return runCliStep(
        initArgs(ctx.home, writeTempFile(ctx.home, "ambiguous.txt", ambiguous)),
        { timeoutMs: 60_000 },
      )(ctx);
    },
    assertExit(2),
    assertJson<{ success: boolean; errorMessage: string }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorMessage).toContain("Multiple valid recovery phrases found");
    }),
  ]),
  defineScenario("does not leak the mnemonic in JSON output", [
    (ctx) => {
      const cliBackup = [
        "Privacy Pools Recovery Phrase",
        "",
        "Recovery Phrase:",
        TEST_MNEMONIC,
        "",
        "IMPORTANT: Keep this file secure.",
      ].join("\n");
      return runCliStep(
        initArgs(ctx.home, writeTempFile(ctx.home, "cli-backup.txt", cliBackup)),
        { timeoutMs: 60_000 },
      )(ctx);
    },
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).not.toContain(TEST_MNEMONIC);
    }),
  ]),
  defineScenario("imports structured files with windows line endings", [
    (ctx) => {
      const cliBackup = [
        "Privacy Pools Recovery Phrase",
        "",
        "Recovery Phrase:",
        TEST_MNEMONIC,
        "",
        "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
        "Anyone with this phrase can access your Privacy Pools deposits.",
      ].join("\r\n");
      return runCliStep(
        initArgs(ctx.home, writeTempFile(ctx.home, "windows-backup.txt", cliBackup)),
        { timeoutMs: 60_000 },
      )(ctx);
    },
    assertExit(0),
    assertJson<{ success: boolean }>((json) => {
      expect(json.success).toBe(true);
    }),
  ]),
]);
