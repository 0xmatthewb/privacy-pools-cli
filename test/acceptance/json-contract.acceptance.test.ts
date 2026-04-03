import { expect } from "bun:test";
import { join } from "node:path";
import {
  CLI_PROTOCOL_PROFILE,
  buildRuntimeCompatibilityDescriptor,
} from "../../src/config/protocol-profile.js";
import { readCliPackageInfo } from "../../src/package-info.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { writeTestSecretFiles } from "../helpers/cli.ts";
import { writeWorkflowSnapshot } from "../helpers/workflow-snapshot.ts";
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
const UPDATE_REGISTRY_ENV = {
  PRIVACY_POOLS_NPM_REGISTRY_URL:
    'data:application/json,{"version":"9.9.9"}',
  PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
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
        "withdraw quote <amount> --asset <symbol|address>",
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
  defineScenario("upgrade check keeps the source-checkout manual JSON contract", [
    runCliStep(["--json", "upgrade", "--check"], {
      timeoutMs: 10_000,
      env: UPDATE_REGISTRY_ENV,
    }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      status: string;
      updateAvailable: boolean;
      performed: boolean;
      command: string | null;
      installContext: { kind: string; supportedAutoRun: boolean };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("upgrade");
      expect(json.status).toBe("manual");
      expect(json.updateAvailable).toBe(true);
      expect(json.performed).toBe(false);
      expect(json.command).toBe("npm install -g privacy-pools-cli@9.9.9");
      expect(json.installContext.kind).toBe("source_checkout");
      expect(json.installContext.supportedAutoRun).toBe(false);
    }),
  ]),
  defineScenario("activity offline contract stays machine-parseable", [
    runCliStep(["--json", "--chain", "mainnet", "activity"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
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
      expect(json.errorCode).toBe("RPC_NETWORK_ERROR");
      expect(json.errorMessage).toContain("fetch failed");
      expect(json.error.category).toBe("RPC");
      expect(json.error.retryable).toBe(true);
      expect(json.error.hint).toContain("Check your RPC URL");
    }),
  ]),
  defineScenario("stats offline contract stays machine-parseable", [
    runCliStep(["--json", "stats"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(3),
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
      expect(json.errorCode).toBe("RPC_NETWORK_ERROR");
      expect(json.errorMessage).toContain("fetch failed");
      expect(json.error.category).toBe("RPC");
      expect(json.error.retryable).toBe(true);
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
      expect(json.nextActions?.[0]?.command).toBe("migrate status");
    }),
  ]),
  defineScenario("flow status keeps the saved workflow JSON contract", [
    (ctx) => {
      writeWorkflowSnapshot(ctx.home, "wf-json-flow", {
        phase: "approved_waiting_privacy_delay",
        chain: "mainnet",
        asset: "USDC",
        assetDecimals: 6,
        depositAmount: "100000000",
        recipient: "0x7777777777777777777777777777777777777777",
        poolAccountId: "PA-7",
        poolAccountNumber: 7,
        committedValue: "99500000",
        aspStatus: "approved",
        privacyDelayProfile: "balanced",
        privacyDelayConfigured: true,
        privacyDelayUntil: "2026-03-28T16:00:00.000Z",
      });
    },
    runCliStep(["--json", "flow", "status", "wf-json-flow"], {
      timeoutMs: 10_000,
    }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      action: string;
      workflowId: string;
      phase: string;
      walletMode: string;
      chain: string;
      asset: string;
      recipient: string;
      poolAccountId: string | null;
      poolAccountNumber: number | null;
      committedValue: string | null;
      aspStatus?: string;
      privacyDelayProfile: string;
      privacyDelayConfigured: boolean;
      privacyDelayUntil: string | null;
      warnings?: Array<{ code: string; category: string; message: string }>;
      nextActions?: Array<{
        command: string;
        reason: string;
        when: string;
        args?: string[];
        options?: Record<string, unknown>;
      }>;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("flow");
      expect(json.action).toBe("status");
      expect(json.workflowId).toBe("wf-json-flow");
      expect(json.phase).toBe("approved_waiting_privacy_delay");
      expect(json.walletMode).toBe("configured");
      expect(json.chain).toBe("mainnet");
      expect(json.asset).toBe("USDC");
      expect(json.recipient).toBe("0x7777777777777777777777777777777777777777");
      expect(json.poolAccountId).toBe("PA-7");
      expect(json.poolAccountNumber).toBe(7);
      expect(json.committedValue).toBe("99500000");
      expect(json.aspStatus).toBe("approved");
      expect(json.privacyDelayProfile).toBe("balanced");
      expect(json.privacyDelayConfigured).toBe(true);
      expect(json.privacyDelayUntil).toBe("2026-03-28T16:00:00.000Z");
      expect(json.warnings).toEqual([
        {
          code: "amount_pattern_linkability",
          category: "privacy",
          message:
            "This saved flow will auto-withdraw the full 99.5 USDC. That pattern can make the withdrawal more identifiable even though the protocol breaks the direct onchain link. Consider manual round partial withdrawals such as 99 USDC if you want better amount privacy.",
        },
      ]);
      expect(json.nextActions).toHaveLength(1);
      expect(json.nextActions?.[0]).toMatchObject({
        command: "flow watch",
        when: "flow_resume",
        args: ["wf-json-flow"],
        options: { agent: true },
      });
      expect(json.nextActions?.[0]?.reason).toContain(
        "This workflow is intentionally waiting until",
      );
      expect(json.nextActions?.[0]?.reason).toContain(
        "before requesting the private withdrawal.",
      );
    }),
  ]),
]);
