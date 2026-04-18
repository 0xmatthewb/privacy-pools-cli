import { expect } from "bun:test";
import {
  assertExit,
  assertJson,
  assertStderrEmpty,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
} from "./framework.ts";

defineScenarioSuite("machine-mode acceptance", [
  defineScenario("unknown commands stay machine-readable in --agent mode", [
    runCliStep(["--agent", "accunts"]),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      suggestions: string[];
      error: { category: string; suggestions: string[]; details: { suggestions: string[] } };
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_UNKNOWN_COMMAND");
      expect(json.error.category).toBe("INPUT");
      expect(json.suggestions).toContain("accounts");
      expect(json.error.suggestions).toEqual(json.suggestions);
      expect(json.error.details.suggestions).toEqual(json.suggestions);
      expect(json.errorMessage.toLowerCase()).toContain("unknown command");
    }),
  ]),
  defineScenario("agent help returns a JSON help envelope", [
    runCliStep(["--agent", "help", "deposit"]),
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
      expect(json.help).toContain("Usage: privacy-pools deposit");
      expect(json.help).not.toContain("(outputHelp)");
    }),
  ]),
  defineScenario("json help returns a JSON help envelope", [
    runCliStep(["--json", "help", "deposit"]),
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
      expect(json.help).toContain("Usage: privacy-pools deposit");
    }),
  ]),
  defineScenario("agent guide returns a JSON payload", [
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
      expect(typeof json.help).toBe("string");
    }),
  ]),
  defineScenario("agent guide stays structured when csv is also requested", [
    runCliStep(["--agent", "--output", "csv", "guide"]),
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
      expect(json.help).toContain("Privacy Pools: Quick Guide");
    }),
  ]),
  defineScenario("json capabilities stays structured when csv is also requested", [
    runCliStep(["--json", "--output", "csv", "capabilities"]),
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
  defineScenario("static guide supports yaml output when explicitly requested", [
    runCliStep(["--json", "--output", "yaml", "guide"]),
    assertExit(0),
    assertStderrEmpty(),
    (ctx) => {
      expect(ctx.lastResult).not.toBeNull();
      const stdout = ctx.lastResult?.stdout ?? "";
      expect(stdout).toContain("schemaVersion: 2.0.0");
      expect(stdout).toContain("success: true");
      expect(stdout).toContain("mode: help");
      expect(stdout).toContain("Privacy Pools: Quick Guide");
    },
  ]),
  defineScenario("agent root help returns a JSON envelope", [
    runCliStep(["--agent", "help"]),
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
      expect(json.help).toContain("Usage: privacy-pools");
    }),
  ]),
  defineScenario("json root help returns a JSON envelope", [
    runCliStep(["--json", "help"]),
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
      expect(json.help).toContain("Usage: privacy-pools");
    }),
  ]),
  defineScenario("agent version returns a JSON version envelope", [
    runCliStep(["--agent", "--version"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      version: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("version");
      expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    }),
  ]),
]);
