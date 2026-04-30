import { expect } from "bun:test";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
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
      error: { category: string; details: { suggestions: string[] } };
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_UNKNOWN_COMMAND");
      expect(json.error.category).toBe("INPUT");
      expect(json.error.details.suggestions).toContain("accounts");
      expect(json.errorMessage.toLowerCase()).toContain("unknown command");
    }),
  ]),
  defineScenario("agent help returns a JSON help envelope", [
    runCliStep(["--agent", "deposit", "--help"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      action: string;
      operation: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("describe");
      expect(json.action).toBe("help");
      expect(json.operation).toBe("describe.help");
      expect(json.help).toContain("Usage: privacy-pools deposit");
      expect(json.help).not.toContain("(outputHelp)");
    }),
  ]),
  defineScenario("json help returns a JSON help envelope", [
    runCliStep(["--json", "deposit", "--help"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      action: string;
      operation: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("describe");
      expect(json.action).toBe("help");
      expect(json.operation).toBe("describe.help");
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
      operation: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("guide");
      expect(json.operation).toBe("guide");
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
      operation: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("guide");
      expect(json.operation).toBe("guide");
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
      expect(stdout).toContain(`schemaVersion: ${JSON_SCHEMA_VERSION}`);
      expect(stdout).toContain("success: true");
      expect(stdout).toContain("mode: guide");
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
      action: string;
      operation: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("describe");
      expect(json.action).toBe("help");
      expect(json.operation).toBe("describe.help");
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
      action: string;
      operation: string;
      help: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("describe");
      expect(json.action).toBe("help");
      expect(json.operation).toBe("describe.help");
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
      action: string;
      operation: string;
      version: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("status");
      expect(json.action).toBe("version");
      expect(json.operation).toBe("status.version");
      expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    }),
  ]),
]);
