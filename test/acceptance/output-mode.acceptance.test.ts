import { expect } from "bun:test";
import {
  assertExit,
  assertJson,
  assertStderr,
  assertStderrEmpty,
  assertStdout,
  assertStdoutEmpty,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  seedHome,
} from "./framework.ts";

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

defineScenarioSuite("output-mode acceptance", [
  defineScenario("bare welcome stays silent in quiet mode", [
    runCliStep(["--quiet"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderrEmpty(),
  ]),
  defineScenario("guide writes guide text to stderr in human mode", [
    runCliStep(["guide"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Quick Start");
      expect(stderr).toContain("Workflow");
      expect(stderr).not.toContain("\u001b[");
    }),
  ]),
  defineScenario("guide stays fully silent in quiet mode", [
    runCliStep(["--quiet", "guide"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderrEmpty(),
  ]),
  defineScenario("capabilities writes the command catalog to stderr in human mode", [
    runCliStep(["capabilities"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Agent Capabilities");
      expect(stderr).toContain("Commands:");
      expect(stderr).toContain("Global flags:");
      expect(stderr).toContain("Typical agent workflow:");
    }),
  ]),
  defineScenario("capabilities stays fully silent in quiet mode", [
    runCliStep(["--quiet", "capabilities"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderrEmpty(),
  ]),
  defineScenario("describe writes command details to stderr in human mode", [
    runCliStep(["describe", "withdraw", "quote"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Command: withdraw quote");
      expect(stderr).toMatch(
        /Usage:\s+privacy-pools withdraw quote <amount> --asset <symbol\|address>/,
      );
    }),
  ]),
  defineScenario("describe stays fully silent in quiet mode", [
    runCliStep(["--quiet", "describe", "withdraw", "quote"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderrEmpty(),
  ]),
  defineScenario("status stays fully silent in quiet mode", [
    seedHome("sepolia"),
    runCliStep(["--quiet", "--no-banner", "status", "--no-check"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderrEmpty(),
  ]),
  defineScenario("status without init writes readiness warnings to stderr", [
    runCliStep(["--no-banner", "status"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Privacy Pools CLI Status");
      expect(stderr).toMatch(/Config:\s+not found/);
      expect(stderr).toContain("Run 'privacy-pools init'");
      expect(stderr).toContain(
        "privacy-pools init --recovery-phrase-file <downloaded-file>",
      );
    }),
  ]),
  defineScenario("status with init writes wallet readiness details to stderr", [
    seedHome("sepolia"),
    runCliStep(["--no-banner", "--rpc-url", "http://127.0.0.1:9", "status"], {
      env: OFFLINE_ENV,
    }),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Privacy Pools CLI Status");
      expect(stderr).toContain("Recovery phrase: set");
      expect(stderr).toContain("Signer key:");
    }),
  ]),
  defineScenario("completion scripts still write to stdout", [
    runCliStep(["completion", "bash"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).toContain("_privacy_pools_completion");
    }),
    runCliStep(["completion", "zsh"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).toContain("compdef");
    }),
  ]),
  defineScenario("human-mode input errors stay on stderr only", [
    seedHome("sepolia"),
    runCliStep(["deposit", "0.01", "--yes", "--chain", "sepolia"], {
      env: OFFLINE_ENV,
    }),
    assertExit(2),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Error [INPUT]");
    }),
  ]),
  defineScenario("agent guide emits JSON on stdout and nothing on stderr", [
    runCliStep(["--agent", "guide"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("help");
      expect(json.help).toContain("privacy-pools capabilities --agent");
    }),
  ]),
  defineScenario("agent capabilities emits JSON on stdout and nothing on stderr", [
    runCliStep(["--agent", "capabilities"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      commands: unknown[];
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.commands.length).toBeGreaterThan(0);
    }),
  ]),
  defineScenario("agent describe emits JSON on stdout and nothing on stderr", [
    runCliStep(["--agent", "describe", "withdraw", "quote"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      command: string;
      usage: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.command).toBe("withdraw quote");
      expect(json.usage).toBe("withdraw quote <amount> --asset <symbol|address>");
    }),
  ]),
  defineScenario(
    "agent status emits JSON on stdout and nothing on stderr",
    [
      seedHome("sepolia"),
      runCliStep(["--agent", "status"], { timeoutMs: 60_000 }),
      assertExit(0),
      assertStderrEmpty(),
      assertJson<{ schemaVersion: string; success: boolean }>((json) => {
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(json.success).toBe(true);
      }),
    ],
    { timeoutMs: 120_000 },
  ),
  defineScenario("agent completion emits JSON on stdout and nothing on stderr", [
    runCliStep(["--agent", "completion", "bash"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ schemaVersion: string; success: boolean; mode: string }>(
      (json) => {
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(json.success).toBe(true);
        expect(json.mode).toBe("completion-script");
      },
    ),
  ]),
]);
