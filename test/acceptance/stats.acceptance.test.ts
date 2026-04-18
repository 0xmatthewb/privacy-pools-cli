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
const STATS_STEP_TIMEOUT_MS = 20_000;

defineScenarioSuite("stats acceptance", [
  defineScenario("stats input validation stays machine-readable", [
    runCliStep(["--json", "stats", "pool", "--chain", "sepolia"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
      expect(json.error.message).toContain("asset");
    }),
    runCliStep(["--json", "--chain", "mainnet", "stats", "global"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(2),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("--chain");
    }),
    runCliStep(["--json", "stats"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
  defineScenario("stats offline envelopes stay classified and silent in machine mode", [
    runCliStep(["--json", "stats"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
    runCliStep(["--json", "stats", "global"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
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
      expect(typeof json.error.category).toBe("string");
    }),
    runCliStep(["--json", "--chain", "mainnet", "stats", "pool", "ETH"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
      errorCode: string;
      errorMessage: string;
      error: {
        category: string;
        code?: string;
        hint: string;
        retryable?: boolean;
      };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.errorMessage).toContain('No pool found for asset "ETH" on mainnet.');
      expect(json.error.category).toBe("INPUT");
      expect(json.error.hint).toContain("positional asset");
      expect(json.error.retryable).toBe(false);
    }),
  ]),
  defineScenario("stats human mode keeps stdout clean", [
    runCliStep(["stats"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Error");
    }),
    runCliStep(["stats", "pool", "--chain", "sepolia"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(2),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Error");
    }),
  ]),
  defineScenario("stats agent and quiet modes keep stream boundaries intact", [
    runCliStep(["--agent", "stats"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
    runCliStep(["--agent", "stats", "pool", "--chain", "sepolia"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
      expect(json.error.message).toContain("asset");
    }),
    runCliStep(["--agent", "stats", "global"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
    runCliStep(["--quiet", "stats"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
    assertStdoutEmpty(),
  ]),
  defineScenario("stats error envelopes stay complete", [
    runCliStep(["--json", "stats"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
    runCliStep(["--json", "stats", "pool", "--chain", "sepolia"], {
      timeoutMs: STATS_STEP_TIMEOUT_MS,
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
  ]),
]);
