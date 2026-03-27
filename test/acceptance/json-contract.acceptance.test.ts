import { expect } from "bun:test";
import { join } from "node:path";
import {
  CLI_PROTOCOL_PROFILE,
  buildRuntimeCompatibilityDescriptor,
} from "../../src/config/protocol-profile.js";
import { readCliPackageInfo } from "../../src/package-info.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { writeTestSecretFiles } from "../helpers/cli.ts";
import {
  assertExit,
  assertJson,
  assertStderrEmpty,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  seedHome,
} from "./framework.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};
const CLI_VERSION = readCliPackageInfo(import.meta.url).version;

defineScenarioSuite("json-contract acceptance", [
  defineScenario("status without init keeps the readiness JSON contract", [
    runCliStep(["--json", "status"], { timeoutMs: 10_000 }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
      recoveryPhraseSet: boolean;
      signerKeySet: boolean;
      signerAddress: string | null;
      readyForDeposit: boolean;
      readyForWithdraw: boolean;
      readyForUnsigned: boolean;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.configExists).toBe(false);
      expect(json.recoveryPhraseSet).toBe(false);
      expect(json.signerKeySet).toBe(false);
      expect(json.signerAddress).toBeNull();
      expect(json.readyForDeposit).toBe(false);
      expect(json.readyForWithdraw).toBe(false);
      expect(json.readyForUnsigned).toBe(false);
    }),
  ]),
  defineScenario("status with init keeps semantic health fields", [
    seedHome("sepolia"),
    runCliStep(["--json", "--rpc-url", "http://127.0.0.1:9", "status"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
      defaultChain: string;
      selectedChain: string;
      recoveryPhraseSet: boolean;
      signerKeySet: boolean;
      signerKeyValid: boolean;
      signerAddress: string | null;
      aspLive?: boolean;
      rpcLive?: boolean;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.configExists).toBe(true);
      expect(json.defaultChain).toBe("sepolia");
      expect(json.selectedChain).toBe("sepolia");
      expect(json.recoveryPhraseSet).toBe(true);
      expect(json.signerKeySet).toBe(true);
      expect(json.signerKeyValid).toBe(true);
      expect(typeof json.signerAddress).toBe("string");
      expect(typeof json.aspLive).toBe("boolean");
      expect(typeof json.rpcLive).toBe("boolean");
    }),
  ]),
  defineScenario("capabilities exposes the expected machine metadata", [
    runCliStep(["--json", "capabilities"], { timeoutMs: 10_000 }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      commands: Array<{ name: string }>;
      commandDetails: Record<string, { command: string; usage?: string }>;
      protocol: { profile: string; coreSdkVersion: string };
      runtime: { cliVersion: string; runtimeVersion: string; jsonSchemaVersion: string };
      documentation?: { reference?: string; agentGuide?: string };
      safeReadOnlyCommands: string[];
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.commands.map((command) => command.name)).toContain(
        "withdraw quote",
      );
      expect(json.commands.map((command) => command.name)).toContain(
        "capabilities",
      );
      expect(json.commandDetails["withdraw quote"]?.command).toBe(
        "withdraw quote",
      );
      expect(json.commandDetails["withdraw quote"]?.usage).toBe(
        "withdraw quote <amount|asset> [amount]",
      );
      expect(json.protocol).toEqual(CLI_PROTOCOL_PROFILE);
      expect(json.runtime).toMatchObject(
        buildRuntimeCompatibilityDescriptor(CLI_VERSION),
      );
      expect(json.documentation).toMatchObject({
        reference: "docs/reference.md",
        agentGuide: "AGENTS.md",
      });
      expect(json.safeReadOnlyCommands).toContain("status");
    }),
  ]),
  defineScenario("activity offline contract stays machine-parseable", [
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
      error: { category: string; retryable: boolean; hint: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("UNKNOWN_ERROR");
      expect(json.errorMessage).toContain("Unable to connect");
      expect(json.error.category).toBe("UNKNOWN");
      expect(json.error.retryable).toBe(false);
      expect(json.error.hint).toContain("report it");
    }),
  ]),
  defineScenario("stats offline contract stays machine-parseable", [
    runCliStep(["--json", "stats"], {
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
      error: { category: string; retryable: boolean };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("UNKNOWN_ERROR");
      expect(json.errorMessage).toContain("Unable to connect");
      expect(json.error.category).toBe("UNKNOWN");
      expect(json.error.retryable).toBe(false);
    }),
  ]),
  defineScenario("pools offline contract keeps the ASP error semantics", [
    runCliStep(["--json", "--chain", "sepolia", "pools"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(4),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; code: string; retryable: boolean };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("ASP_ERROR");
      expect(json.errorMessage).toContain("Cannot reach ASP");
      expect(json.error.category).toBe("ASP");
      expect(json.error.code).toBe("ASP_ERROR");
      expect(json.error.retryable).toBe(false);
    }),
  ]),
  defineScenario("stats pool without --asset keeps the INPUT contract", [
    runCliStep(["--json", "stats", "pool", "--chain", "sepolia"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; code: string; hint: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.errorMessage).toBe(
        "Missing required --asset <symbol|address>.",
      );
      expect(json.error.category).toBe("INPUT");
      expect(json.error.code).toBe("INPUT_ERROR");
      expect(json.error.hint).toContain("stats pool --asset ETH");
    }),
  ]),
  defineScenario("init keeps the semantic setup contract", [
    (ctx) => {
      writeTestSecretFiles(ctx.home);
    },
    (ctx) =>
      runCliStep(
        [
          "--json",
          "init",
          "--mnemonic-file",
          join(ctx.home, ".test-secrets", "mnemonic.txt"),
          "--private-key-file",
          join(ctx.home, ".test-secrets", "private-key.txt"),
          "--default-chain",
          "sepolia",
          "--yes",
        ],
        { timeoutMs: 30_000 },
      )(ctx),
    assertExit(0),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      defaultChain: string;
      signerKeySet: boolean;
      nextActions?: Array<{ command: string }>;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.defaultChain).toBe("sepolia");
      expect(json.signerKeySet).toBe(true);
      expect(json.nextActions?.[0]?.command).toBe("accounts");
    }),
  ]),
]);
