import { afterAll, beforeAll, expect } from "bun:test";
import { join } from "node:path";
import { TEST_MNEMONIC, TEST_PRIVATE_KEY, writeTestSecretFiles } from "../helpers/cli.ts";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import {
  assertExit,
  assertJson,
  assertStderr,
  assertStderrEmpty,
  assertStdoutEmpty,
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

function seedSecretFilesStep() {
  return (ctx: { home: string }) => {
    writeTestSecretFiles(ctx.home);
  };
}

defineScenarioSuite("agent improvements acceptance", [
  defineScenario(
    "describe returns detailed descriptors and keeps human summaries on stderr",
    [
      runCliStep(["--json", "describe", "withdraw", "quote"]),
      assertExit(0),
      assertStderrEmpty(),
      assertJson<{
        command: string;
        usage: string;
        flags: string[];
        globalFlags: string[];
        requiresInit: boolean;
        expectedLatencyClass: string;
      }>((json) => {
        expect(json.command).toBe("withdraw quote");
        expect(json.usage).toBe("withdraw quote <amount|asset> [amount]");
        expect(json.flags).toContain("--to <address>");
        expect(json.globalFlags).toContain("--agent");
        expect(json.requiresInit).toBe(true);
        expect(json.expectedLatencyClass).toBe("medium");
      }),
      runCliStep(["describe", "stats", "global", "--agent"]),
      assertExit(0),
      assertStderrEmpty(),
      assertJson<{
        command: string;
        usage: string;
        expectedLatencyClass: string;
        globalFlags: string[];
      }>((json) => {
        expect(json.command).toBe("stats global");
        expect(json.usage).toBe("stats global");
        expect(json.expectedLatencyClass).toBe("medium");
        expect(json.globalFlags).not.toContain("-c, --chain <name>");
      }),
      runCliStep(["describe", "stats", "global"]),
      assertExit(0),
      assertStdoutEmpty(),
      assertStderr((stderr) => {
        expect(stderr).toContain("Command: stats global");
        expect(stderr).toContain("Usage: privacy-pools stats global");
      }),
    ],
  ),
  defineScenario("describe unknown command paths stay machine-readable", [
    runCliStep(["--json", "describe", "not-a-command"]),
    assertExit(2),
    assertJson<{
      error: { category: string; message: string; hint: string };
    }>((json) => {
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("Unknown command path");
      expect(json.error.hint).toContain("withdraw quote");
      expect(json.error.hint).toContain("stats global");
    }),
  ]),
  defineScenario(
    "capabilities and guide accept unrelated root flags without changing machine contracts",
    [
      runCliStep(["--json", "capabilities"]),
      assertExit(0),
      assertJson<{
        commands: Array<{ name: string }>;
        commandDetails: Record<
          string,
          {
            command: string;
            execution: { owner: string; nativeModes: string[] };
            flags: string[];
            globalFlags: string[];
            safeReadOnly: boolean;
          }
        >;
        executionRoutes: Record<string, { owner: string; nativeModes: string[] }>;
        safeReadOnlyCommands: string[];
      }>((json) => {
        expect(json.commands.map((command) => command.name)).toContain(
          "stats global",
        );
        expect(json.commands.map((command) => command.name)).toContain(
          "stats pool",
        );
        expect(json.commands.map((command) => command.name)).toContain(
          "describe",
        );
        expect(json.commandDetails.accounts?.flags).toContain("--summary");
        expect(json.commandDetails.describe?.command).toBe("describe");
        expect(json.commandDetails["stats global"]?.globalFlags).not.toContain(
          "-c, --chain <name>",
        );
        expect(json.commandDetails.guide?.globalFlags).toContain(
          "--format <format>",
        );
        expect(json.commandDetails.capabilities?.globalFlags).toContain(
          "--format <format>",
        );
        expect(json.commandDetails.status?.execution.owner).toBe("js-runtime");
        expect(json.commandDetails.capabilities?.execution.owner).toBe(
          "native-shell",
        );
        expect(json.executionRoutes["stats pool"]?.owner).toBe("hybrid");
        expect(json.commandDetails.guide?.safeReadOnly).toBe(true);
        expect(json.commandDetails.completion?.safeReadOnly).toBe(true);
        expect(json.safeReadOnlyCommands).toContain("guide");
        expect(json.safeReadOnlyCommands).toContain("completion");
      }),
      runCliStep(["capabilities", "--agent", "--chain", "mainnet"]),
      assertExit(0),
      assertStderrEmpty(),
      assertJson<{
        commands: Array<{ name: string }>;
        commandDetails: Record<string, { command: string }>;
      }>((json) => {
        expect(json.commands.map((command) => command.name)).toContain(
          "describe",
        );
        expect(json.commandDetails.capabilities?.command).toBe("capabilities");
      }),
      runCliStep(["guide", "--agent", "--chain", "mainnet"]),
      assertExit(0),
      assertStderrEmpty(),
      assertJson<{ mode: string; help: string }>((json) => {
        expect(json.mode).toBe("help");
        expect(json.help).toContain("Privacy Pools: Quick Guide");
      }),
    ],
  ),
  defineScenario(
    "init stdin secret modes import successfully without leaking secrets",
    [
      seedSecretFilesStep(),
      (ctx) =>
        runCliStep(
          [
            "--json",
            "init",
            "--mnemonic-stdin",
            "--private-key-file",
            join(ctx.home, ".test-secrets", "private-key.txt"),
            "--default-chain",
            "sepolia",
            "--yes",
          ],
          {
            input: `${TEST_MNEMONIC}\n`,
            timeoutMs: 60_000,
          },
        )(ctx),
      assertExit(0),
      assertJson<{ success: boolean }>((json, ctx) => {
        expect(json.success).toBe(true);
        expect(ctx.lastResult?.stdout).not.toContain(TEST_MNEMONIC);
        expect(ctx.lastResult?.stdout).not.toContain(TEST_PRIVATE_KEY);
      }),
    ],
  ),
  defineScenario(
    "init private-key stdin imports successfully without leaking secrets",
    [
      seedSecretFilesStep(),
      (ctx) =>
        runCliStep(
          [
            "--json",
            "init",
            "--mnemonic-file",
            join(ctx.home, ".test-secrets", "mnemonic.txt"),
            "--private-key-stdin",
            "--default-chain",
            "sepolia",
            "--yes",
          ],
          {
            input: `${TEST_PRIVATE_KEY}\n`,
            timeoutMs: 60_000,
          },
        )(ctx),
      assertExit(0),
      assertJson<{ success: boolean }>((json, ctx) => {
        expect(json.success).toBe(true);
        expect(ctx.lastResult?.stdout).not.toContain(TEST_MNEMONIC);
        expect(ctx.lastResult?.stdout).not.toContain(TEST_PRIVATE_KEY);
      }),
    ],
  ),
  defineScenario("init stdin validation stays targeted and machine-readable", [
    runCliStep(
      [
        "--json",
        "init",
        "--mnemonic-stdin",
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        input: `${TEST_MNEMONIC}\n`,
        timeoutMs: 60_000,
      },
    ),
    assertExit(2),
    assertJson<{ error: { category: string; message: string } }>((json) => {
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain(
        "Cannot read both recovery phrase and signer key from stdin",
      );
    }),
    runCliStep(
      ["--json", "init", "--mnemonic-stdin", "--default-chain", "sepolia", "--yes"],
      { input: "", timeoutMs: 60_000 },
    ),
    assertExit(2),
    assertJson<{ error: { category: string; message: string } }>((json) => {
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain(
        "No valid recovery phrase found in stdin",
      );
    }),
  ]),
  defineScenario(
    "init private-key stdin rejects malformed and empty input cleanly",
    [
      seedSecretFilesStep(),
      (ctx) =>
        runCliStep(
          [
            "--json",
            "init",
            "--mnemonic-file",
            join(ctx.home, ".test-secrets", "mnemonic.txt"),
            "--private-key-stdin",
            "--default-chain",
            "sepolia",
            "--yes",
          ],
          {
            input: "not-a-private-key\n",
            timeoutMs: 60_000,
          },
        )(ctx),
      assertExit(2),
      assertJson<{ error: { category: string; message: string } }>((json) => {
        expect(json.error.category).toBe("INPUT");
        expect(json.error.message).toContain("Invalid private key format");
      }),
      seedSecretFilesStep(),
      (ctx) =>
        runCliStep(
          [
            "--json",
            "init",
            "--mnemonic-file",
            join(ctx.home, ".test-secrets", "mnemonic.txt"),
            "--private-key-stdin",
            "--default-chain",
            "sepolia",
            "--yes",
          ],
          {
            input: "",
            timeoutMs: 60_000,
          },
        )(ctx),
      assertExit(2),
      assertJson<{ error: { category: string; message: string } }>((json) => {
        expect(json.error.category).toBe("INPUT");
        expect(json.error.message).toContain("No private key received on stdin");
      }),
    ],
  ),
  defineScenario("accounts compact-mode validation fails fast", [
    runCliStep(["--json", "accounts", "--summary", "--pending-only"]),
    assertExit(2),
    assertJson<{ errorMessage: string }>((json) => {
      expect(json.errorMessage).toContain(
        "Cannot specify both --summary and --pending-only",
      );
    }),
    runCliStep(["--json", "accounts", "--summary", "--details"]),
    assertExit(2),
    assertJson<{ errorMessage: string }>((json) => {
      expect(json.errorMessage).toContain("do not support --details");
    }),
  ]),
  defineScenario(
    "deposit privacy guard still fails before wallet checks in agent mode",
    [
      (ctx) =>
        runCliStep(
          ["--agent", "deposit", "1.276848", "ETH", "--chain", "sepolia"],
          {
            env: fixtureEnv(),
            timeoutMs: 15_000,
          },
        )(ctx),
      assertExit(2),
      assertStderrEmpty(),
      assertJson<{
        success: boolean;
        error: { category: string; message: string; hint: string };
      }>((json) => {
        expect(json.success).toBe(false);
        expect(json.error.category).toBe("INPUT");
        expect(json.error.message).toContain(
          "Non-round amount 1.276848 ETH may reduce privacy",
        );
        expect(json.error.hint).toContain("--ignore-unique-amount");
        expect(json.error.hint).not.toContain("privacy-pools init");
      }),
    ],
  ),
  defineScenario(
    "deposit ignore-unique-amount advances to the real wallet prerequisite",
    [
      (ctx) =>
        runCliStep(
          [
            "--agent",
            "deposit",
            "1.276848",
            "ETH",
            "--ignore-unique-amount",
            "--chain",
            "sepolia",
          ],
          {
            env: fixtureEnv(),
            timeoutMs: 15_000,
          },
        )(ctx),
      assertExit(2),
      assertStderrEmpty(),
      assertJson<{
        success: boolean;
        error: { category: string; message: string; hint: string };
      }>((json) => {
        expect(json.success).toBe(false);
        expect(json.error.category).toBe("INPUT");
        expect(json.error.message).toContain("No recovery phrase found");
        expect(json.error.message).not.toContain("Non-round amount");
        expect(json.error.hint).toContain("privacy-pools init");
      }),
    ],
  ),
]);
