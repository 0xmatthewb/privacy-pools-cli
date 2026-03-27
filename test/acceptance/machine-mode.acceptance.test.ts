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
    runCliStep(["--agent", "not-a-command"]),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string };
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.category).toBe("INPUT");
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
