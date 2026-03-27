import { expect } from "bun:test";
import {
  assertExit,
  assertJson,
  assertStderr,
  assertStderrOnlyStep,
  assertStdoutEmpty,
  assertStdoutOnlyStep,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  seedHome,
} from "./framework.ts";

defineScenarioSuite("stream-boundary acceptance", [
  defineScenario("json status success stays on stdout only", [
    seedHome("sepolia"),
    runCliStep(["--json", "status"], {
      timeoutMs: 60_000,
    }),
    assertExit(0),
    assertStdoutOnlyStep(),
    assertJson<{ success: boolean }>((json) => {
      expect(json.success).toBe(true);
    }),
  ]),
  defineScenario("json deposit input errors stay on stdout only", [
    seedHome("sepolia"),
    runCliStep(["--json", "deposit", "0.1", "--yes"], {
      timeoutMs: 60_000,
    }),
    assertExit(2),
    assertStdoutOnlyStep(),
    assertJson<{ success: boolean; errorCode: string }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
    }),
  ]),
  defineScenario("human deposit input errors stay on stderr only", [
    seedHome("sepolia"),
    runCliStep(["deposit", "0.1", "--yes"], {
      timeoutMs: 60_000,
    }),
    assertExit(2),
    assertStderrOnlyStep(/Error \[INPUT\]/),
  ]),
  defineScenario("human status output stays on stderr only", [
    seedHome("sepolia"),
    runCliStep(["--no-banner", "status"], {
      timeoutMs: 60_000,
    }),
    assertExit(0),
    assertStderr((stderr) => {
      expect(stderr).toContain("Privacy Pools CLI Status");
    }),
    assertStdoutEmpty(),
  ]),
]);
