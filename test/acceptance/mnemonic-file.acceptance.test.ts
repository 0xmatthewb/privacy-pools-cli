import { afterAll, beforeAll, expect } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { TEST_MNEMONIC, writeTestSecretFiles } from "../helpers/cli.ts";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import {
  assertExit,
  assertJson,
  assertStdout,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
} from "./framework.ts";

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await launchFixtureServer();
});

afterAll(async () => {
  await killFixtureServer(fixture);
});

function fixtureEnv() {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
  };
}

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
    "--recovery-phrase-file",
    filePath,
    "--private-key-file",
    privateKeyPath,
    "--default-chain",
    "sepolia",
    "--yes",
  ];
}

defineScenarioSuite("mnemonic-file acceptance", [
  defineScenario("imports website recovery exports end to end", [
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
      ].join("\r\n");
      return runCliStep(
        initArgs(ctx.home, writeTempFile(ctx.home, "website-backup.txt", structured)),
        {
          timeoutMs: 60_000,
          env: fixtureEnv(),
        },
      )(ctx);
    },
    assertExit(0),
    assertJson<{ success: boolean }>((json) => {
      expect(json.success).toBe(true);
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
        {
          timeoutMs: 60_000,
          env: fixtureEnv(),
        },
      )(ctx);
    },
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).not.toContain(TEST_MNEMONIC);
    }),
  ]),
]);
