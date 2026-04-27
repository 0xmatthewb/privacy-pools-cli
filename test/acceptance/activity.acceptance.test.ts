import { expect } from "bun:test";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
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

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};
const ACTIVITY_STEP_TIMEOUT_MS = 15_000;

function activityArgs(...args: string[]): string[] {
  return ["--timeout", "1", ...args];
}

defineScenarioSuite("activity acceptance", [
  defineScenario("activity input validation stays machine-readable", [
    runCliStep(activityArgs("--json", "activity", "--page", "0", "--chain", "sepolia"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("--page");
    }),
    runCliStep(activityArgs("--json", "activity", "--limit", "0", "--chain", "sepolia"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(2),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("--limit");
    }),
    runCliStep(
      activityArgs("--json", "activity", "--page", "abc", "--chain", "sepolia"),
      {
        timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
        env: OFFLINE_ASP_ENV,
      },
    ),
    assertExit(2),
    assertJson<{
      success: boolean;
      error: { category: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
    }),
  ]),
  defineScenario("activity offline envelopes stay classified and silent in machine mode", [
    runCliStep(activityArgs("--json", "--chain", "mainnet", "activity"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; code: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(typeof json.errorCode).toBe("string");
      expect(typeof json.errorMessage).toBe("string");
      expect(typeof json.error.category).toBe("string");
      expect(typeof json.error.code).toBe("string");
      expect(typeof json.error.message).toBe("string");
    }),
    runCliStep(activityArgs("--json", "--chain", "mainnet", "activity", "ETH"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: {
        ...OFFLINE_ASP_ENV,
        PRIVACY_POOLS_RPC_URL_ETHEREUM: "http://127.0.0.1:9",
      },
    }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode?: string;
      errorMessage?: string;
      error: { category: string; code?: string; hint?: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_UNKNOWN_ASSET");
      expect(json.errorMessage).toContain('No pool found for asset "ETH" on mainnet.');
      expect(json.error.category).toBe("INPUT");
      expect(json.error.code).toBe("INPUT_UNKNOWN_ASSET");
      expect(json.error.hint).toContain("ASP may be offline");
    }),
  ]),
  defineScenario("activity human mode keeps stdout clean and does not require init", [
    runCliStep(activityArgs("--chain", "mainnet", "activity"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Error");
    }),
    runCliStep(activityArgs("--json", "--chain", "sepolia", "activity"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertJson<{
      success: boolean;
      error: { category: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).not.toBe("INPUT");
    }),
  ]),
  defineScenario("activity agent and quiet modes keep stream boundaries intact", [
    runCliStep(activityArgs("--agent", "--chain", "mainnet", "activity"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
    }),
    runCliStep(
      [
        "--timeout",
        "1",
        "--agent",
        "--chain",
        "mainnet",
        "activity",
        "--page",
        "2",
        "--limit",
        "5",
      ],
      {
        timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
        env: OFFLINE_ASP_ENV,
      },
    ),
    assertExit(3),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
    }),
    runCliStep(activityArgs("--quiet", "--chain", "mainnet", "activity"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertStdoutEmpty(),
  ]),
  defineScenario("activity error envelopes stay complete", [
    runCliStep(activityArgs("--json", "activity", "--page", "0", "--chain", "sepolia"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(2),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode?: string;
      errorMessage?: string;
      error: { category: string; code?: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(typeof json.errorMessage).toBe("string");
    }),
    runCliStep(activityArgs("--json", "--chain", "mainnet", "activity"), {
      timeoutMs: ACTIVITY_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode?: string;
      errorMessage?: string;
      error: { category: string; code?: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(typeof json.errorCode).toBe("string");
      expect(typeof json.errorMessage).toBe("string");
      expect(typeof json.error.category).toBe("string");
    }),
  ]),
]);
