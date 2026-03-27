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

defineScenarioSuite("activity acceptance", [
  defineScenario("activity input validation stays machine-readable", [
    runCliStep(["--json", "activity", "--page", "0", "--chain", "sepolia"], {
      timeoutMs: 10_000,
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
    runCliStep(["--json", "activity", "--limit", "0", "--chain", "sepolia"], {
      timeoutMs: 10_000,
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
      ["--json", "activity", "--page", "abc", "--chain", "sepolia"],
      {
        timeoutMs: 10_000,
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
    runCliStep(["--json", "--chain", "mainnet", "activity"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(1),
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
    runCliStep(["--json", "--chain", "mainnet", "activity", "--asset", "ETH"], {
      timeoutMs: 10_000,
      env: {
        ...OFFLINE_ASP_ENV,
        PRIVACY_POOLS_RPC_URL_ETHEREUM: "http://127.0.0.1:9",
      },
    }),
    assertExit(3),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("RPC");
    }),
  ]),
  defineScenario("activity human mode keeps stdout clean and does not require init", [
    runCliStep(["--chain", "mainnet", "activity"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(1),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Error");
    }),
    runCliStep(["--json", "--chain", "sepolia", "activity"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(1),
    assertJson<{
      success: boolean;
      error: { category: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).not.toBe("INPUT");
    }),
  ]),
  defineScenario("activity agent and quiet modes keep stream boundaries intact", [
    runCliStep(["--agent", "--chain", "mainnet", "activity"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(1),
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
        timeoutMs: 10_000,
        env: OFFLINE_ASP_ENV,
      },
    ),
    assertExit(1),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
    }),
    runCliStep(["--quiet", "--chain", "mainnet", "activity"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(1),
    assertStdoutEmpty(),
  ]),
  defineScenario("activity error envelopes stay complete", [
    runCliStep(["--json", "activity", "--page", "0", "--chain", "sepolia"], {
      timeoutMs: 10_000,
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
    runCliStep(["--json", "--chain", "mainnet", "activity"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(1),
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
