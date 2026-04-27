import { afterAll, beforeAll, expect } from "bun:test";
import { join } from "node:path";
import {
  CLI_PROTOCOL_PROFILE,
  buildRuntimeCompatibilityDescriptor,
} from "../../src/config/protocol-profile.js";
import { readCliPackageInfo } from "../../src/package-info.ts";
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
const CLI_VERSION = readCliPackageInfo(import.meta.url).version;

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
        group: string;
        usage: string;
        flags: string[];
        globalFlags: string[];
        requiresInit: boolean;
        expectedLatencyClass: string;
      }>((json) => {
        expect(json.command).toBe("withdraw quote");
        expect(json.group).toBe("transaction");
        expect(json.usage).toBe("withdraw quote <amount> <asset>");
        expect(json.flags).toContain("--to <address>");
        expect(json.globalFlags).toContain("--agent");
        expect(json.requiresInit).toBe(true);
        expect(json.expectedLatencyClass).toBe("medium");
      }),
      runCliStep(["describe", "protocol-stats", "--agent"]),
      assertExit(0),
      assertStderrEmpty(),
      assertJson<{
        command: string;
        group: string;
        usage: string;
        expectedLatencyClass: string;
        globalFlags: string[];
      }>((json) => {
        expect(json.command).toBe("protocol-stats");
        expect(json.group).toBe("monitoring");
        expect(json.usage).toBe("protocol-stats");
        expect(json.expectedLatencyClass).toBe("medium");
        expect(json.globalFlags).not.toContain("-c, --chain <name>");
      }),
      runCliStep(["describe", "protocol-stats"]),
      assertExit(0),
      assertStdoutEmpty(),
      assertStderr((stderr) => {
        expect(stderr).toContain("Command: protocol-stats");
        expect(stderr).toMatch(/Usage:\s+privacy-pools protocol-stats/);
      }),
    ],
  ),
  defineScenario("flow discovery exposes dry-run next-action metadata", [
    runCliStep(["describe", "flow", "--agent"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      expectedNextActionWhen: string[];
      jsonVariants: string[];
      agentWorkflowNotes: string[];
    }>((json) => {
      expect(json.expectedNextActionWhen).toEqual([
        "after_dry_run",
        "flow_resume",
        "flow_public_recovery_required",
        "flow_declined",
        "flow_public_recovery_pending",
        "flow_public_recovery_optional",
        "flow_manual_followup",
      ]);
      expect(json.jsonVariants.some((variant) => variant.includes("flow start --dry-run"))).toBe(true);
      expect(json.agentWorkflowNotes.some((note) => note.includes("flow start"))).toBe(true);
    }),
    runCliStep(["describe", "flow", "start", "--agent"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      expectedNextActionWhen: string[];
      jsonVariants: string[];
      supportsDryRun: boolean;
    }>((json) => {
      expect(json.supportsDryRun).toBe(true);
      expect(json.expectedNextActionWhen[0]).toBe("after_dry_run");
      expect(json.jsonVariants.some((variant) => variant.includes("--dry-run"))).toBe(true);
    }),
    runCliStep(["describe", "describe", "--agent"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ jsonFields: string }>((json) => {
      expect(json.jsonFields).toContain("expectedNextActionWhen?");
    }),
    runCliStep(["capabilities", "--agent"]),
    assertExit(0),
    assertStderrEmpty(),
      assertJson<{
        commands: Array<{ name: string; group: string }>;
        commandDetails: Record<string, { expectedNextActionWhen?: string[]; jsonVariants?: string[]; group?: string }>;
      }>((json) => {
        expect(json.commands.find((command) => command.name === "flow watch")?.group).toBe(
          "transaction",
        );
        expect(json.commandDetails.flow?.expectedNextActionWhen?.[0]).toBe("after_dry_run");
        expect(json.commandDetails["flow start"]?.expectedNextActionWhen?.[0]).toBe("after_dry_run");
        expect(json.commandDetails["flow watch"]?.group).toBe("transaction");
        expect(
          json.commandDetails["flow start"]?.jsonVariants?.some((variant) =>
            variant.includes("--dry-run"),
        ),
      ).toBe(true);
    }),
  ]),
  defineScenario("describe unknown command paths stay machine-readable", [
    runCliStep(["--json", "describe", "not-a-command"]),
    assertExit(2),
    assertJson<{
      error: { category: string; message: string; hint: string };
    }>((json) => {
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("Unknown command path");
      expect(json.error.hint).toContain("withdraw quote");
      expect(json.error.hint).toContain("protocol-stats");
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
            group: string;
            execution: { owner: string; nativeModes: string[] };
            flags: string[];
            globalFlags: string[];
            safeReadOnly: boolean;
          }
        >;
        executionRoutes: Record<string, { owner: string; nativeModes: string[] }>;
        protocol: { profile: string; coreSdkVersion: string };
        runtime: { cliVersion: string; runtimeVersion: string; nativeBridgeVersion: string };
        safeReadOnlyCommands: string[];
      }>((json) => {
        expect(json.commands.map((command) => command.name)).toContain(
          "protocol-stats",
        );
        expect(json.commands.map((command) => command.name)).toContain(
          "pool-stats",
        );
        expect(json.commands.map((command) => command.name)).toContain(
          "describe",
        );
        expect(json.commands.find((command) => command.name === "capabilities")).toMatchObject({
          name: "capabilities",
        });
        expect(json.commandDetails.accounts?.flags).toContain("--summary");
        expect(json.commandDetails.describe?.command).toBe("describe");
        expect(json.commandDetails.describe?.group).toBe("advanced");
        expect(json.commandDetails["protocol-stats"]?.globalFlags).not.toContain(
          "-c, --chain <name>",
        );
        expect(json.commandDetails.guide?.globalFlags).toContain(
          "-o, --output <format>",
        );
        expect(json.commandDetails.capabilities?.globalFlags).toContain(
          "-o, --output <format>",
        );
        expect(json.commandDetails.status?.execution.owner).toBe("js-runtime");
        expect(json.commandDetails.capabilities?.execution.owner).toBe(
          "native-shell",
        );
        expect(json.executionRoutes["pool-stats"]?.owner).toBe("hybrid");
        expect(json.protocol).toEqual(CLI_PROTOCOL_PROFILE);
        expect(json.runtime).toMatchObject(
          buildRuntimeCompatibilityDescriptor(CLI_VERSION),
        );
        expect(json.commandDetails.guide?.safeReadOnly).toBe(true);
        expect(json.commandDetails.completion?.safeReadOnly).toBe(false);
        expect(json.safeReadOnlyCommands).toContain("guide");
        expect(json.safeReadOnlyCommands).toContain("protocol-stats");
        expect(json.safeReadOnlyCommands).toContain("pool-stats");
        expect(json.safeReadOnlyCommands).not.toContain("stats");
        expect(json.safeReadOnlyCommands).not.toContain("completion");
      }),
      runCliStep(["capabilities", "--agent", "--chain", "mainnet"]),
      assertExit(0),
      assertStderrEmpty(),
      assertJson<{
        commands: Array<{ name: string; group: string }>;
        commandDetails: Record<string, { command: string; group: string }>;
      }>((json) => {
        expect(json.commands.map((command) => command.name)).toContain(
          "describe",
        );
        expect(json.commands.find((command) => command.name === "status")?.group).toBe(
          "getting-started",
        );
        expect(json.commandDetails.capabilities?.command).toBe("capabilities");
        expect(json.commandDetails.capabilities?.group).toBe("advanced");
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
            "--recovery-phrase-stdin",
            "--private-key-file",
            join(ctx.home, ".test-secrets", "private-key.txt"),
            "--default-chain",
            "sepolia",
            "--yes",
          ],
          {
            input: `${TEST_MNEMONIC}\n`,
            timeoutMs: 60_000,
            env: fixtureEnv(),
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
            "--recovery-phrase-file",
            join(ctx.home, ".test-secrets", "mnemonic.txt"),
            "--private-key-stdin",
            "--default-chain",
            "sepolia",
            "--yes",
          ],
          {
            input: `${TEST_PRIVATE_KEY}\n`,
            timeoutMs: 60_000,
            env: fixtureEnv(),
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
        "--recovery-phrase-stdin",
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
      ["--json", "init", "--recovery-phrase-stdin", "--default-chain", "sepolia", "--yes"],
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
            "--recovery-phrase-file",
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
            "--recovery-phrase-file",
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
          "distinctive committed amount",
        );
        expect(json.error.hint).toContain("--allow-non-round-amounts");
        expect(json.error.hint).not.toContain("privacy-pools init");
      }),
    ],
  ),
  defineScenario(
    "deposit allow-non-round-amounts advances to the real wallet prerequisite",
    [
      (ctx) =>
        runCliStep(
          [
            "--agent",
            "deposit",
            "1.276848",
            "ETH",
            "--allow-non-round-amounts",
            "--chain",
            "sepolia",
          ],
          {
            env: fixtureEnv(),
            timeoutMs: 15_000,
          },
        )(ctx),
      assertExit(4),
      assertStderrEmpty(),
      assertJson<{
        success: boolean;
        error: { category: string; message: string; hint: string };
      }>((json) => {
        expect(json.success).toBe(false);
        expect(json.error.category).toBe("SETUP");
        expect(json.error.message).toContain("CLI wallet setup is incomplete");
        expect(json.error.message).not.toContain("Non-round amount");
        expect(json.error.hint).toContain("privacy-pools init");
      }),
    ],
  ),
]);
