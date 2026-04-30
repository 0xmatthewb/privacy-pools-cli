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
  defineScenario("bare quiet invocation falls back to root help", [
    runCliStep(["--quiet"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).toContain("Usage: privacy-pools [options] [command]");
      expect(stdout).toContain("Commands:");
    }),
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
  defineScenario("help fast path resolves new env-vars and next-actions topics", [
    runCliStep(["help", "env-vars"]),
    assertExit(0),
    assertStderrEmpty(),
    assertStdout((stdout) => {
      expect(stdout).toContain("Environment Variable Fallbacks");
      expect(stdout).toContain("PRIVACY_POOLS_AGENT");
    }),
    runCliStep(["help", "next-actions"]),
    assertExit(0),
    assertStderrEmpty(),
    assertStdout((stdout) => {
      expect(stdout).toContain("nextActions");
      expect(stdout).toContain("runnable=true");
    }),
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
        /Usage:\s+privacy-pools withdraw quote <amount> <asset>/,
      );
    }),
  ]),
  defineScenario("describe envelope paths stay machine-readable on the static route", [
    runCliStep(["--agent", "describe", "envelope.shared.nextAction"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ success: boolean; path: string; schema: { cliCommand: string } }>((json) => {
      expect(json.success).toBe(true);
      expect(json.path).toBe("envelope.shared.nextAction");
      expect(json.schema.cliCommand).toContain("omitted when runnable = false");
    }),
  ]),
  defineScenario("describe stays fully silent in quiet mode", [
    runCliStep(["--quiet", "describe", "withdraw", "quote"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderrEmpty(),
  ]),
  defineScenario("command-local --json <fields> trims the JSON envelope", [
    runCliStep(["describe", "withdraw", "--json", "command,usage"], { timeoutMs: 60_000 }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ success: boolean; command: string; usage: string }>((json) => {
      expect(json.command).toBe("withdraw");
      expect(json.usage).toBe("withdraw [amount] [asset] --to <address>");
      expect((json as Record<string, unknown>).description).toBeUndefined();
    }),
  ]),
  defineScenario("status quiet mode prints the documented one-line stdout summary", [
    seedHome("sepolia"),
    runCliStep(["--quiet", "--no-banner", "status", "--no-check"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout.trim()).toBe(
        "status=ready chain=sepolia rpc=unchecked asp=unchecked relayer=unchecked deposits=0",
      );
    }),
    assertStderrEmpty(),
  ]),
  defineScenario("status without init writes readiness warnings to stderr", [
    runCliStep(["--no-banner", "status", "--no-check"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Privacy Pools CLI Status");
      expect(stderr).toMatch(/Config:\s+not found/);
      expect(stderr).toContain("Run 'privacy-pools init'");
      expect(stderr).toContain("Load an existing account:");
    }),
  ]),
  defineScenario("status with init writes wallet readiness details to stderr", [
    seedHome("sepolia"),
    runCliStep(["--no-banner", "status", "--no-check"]),
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
      operation: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("guide");
      expect(json.operation).toBe("guide");
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
  defineScenario("template mode renders structured output without the JSON envelope", [
    runCliStep(["capabilities", "--template", "{{commands.0.group}}"]),
    assertExit(0),
    assertStderrEmpty(),
    assertStdout((stdout) => {
      expect(stdout.trim()).toMatch(/^(getting-started|transaction|monitoring|advanced)$/);
    }),
  ]),
  defineScenario("agent and quiet env fallbacks change real CLI behavior", [
    runCliStep(["capabilities"], {
      env: {
        PRIVACY_POOLS_AGENT: "1",
      },
    }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ success: boolean; commands: Array<{ group: string }> }>((json) => {
      expect(json.success).toBe(true);
      expect(json.commands[0]?.group).toMatch(
        /^(getting-started|transaction|monitoring|advanced)$/,
      );
    }),
    runCliStep(["guide"], {
      env: {
        PRIVACY_POOLS_QUIET: "1",
      },
    }),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderrEmpty(),
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
        expect(json.usage).toBe("withdraw quote <amount> <asset>");
      }),
  ]),
  defineScenario(
    "agent status emits JSON on stdout and nothing on stderr",
    [
      seedHome("sepolia"),
      runCliStep(["--agent", "status", "--no-check"], { timeoutMs: 60_000 }),
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
    assertJson<{ schemaVersion: string; success: boolean; mode: string; action: string; operation: string }>(
      (json) => {
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(json.success).toBe(true);
        expect(json.mode).toBe("completion");
        expect(json.action).toBe("script");
        expect(json.operation).toBe("completion.script");
      },
    ),
  ]),
  defineScenario("agent-aware help injection appears only in agent environments", [
    runCliStep(["withdraw", "--help"], {
      env: {
        CODEX_AGENT: "1",
      },
    }),
    assertExit(0),
    assertStderrEmpty(),
    assertStdout((stdout) => {
      expect(stdout).toContain("Agent guidance:");
      expect(stdout).toContain(
        "Use --agent for --json --yes --quiet when you need a runnable machine contract.",
      );
    }),
  ]),
]);
