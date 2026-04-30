import { afterAll, beforeAll, expect } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  CLI_PROTOCOL_PROFILE,
  buildRuntimeCompatibilityDescriptor,
} from "../../src/config/protocol-profile.js";
import { readCliPackageInfo } from "../../src/package-info.ts";
import { saveAccount } from "../../src/services/account-storage.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import { writeWorkflowSnapshot } from "../helpers/workflow-snapshot.ts";
import {
  assertExit,
  assertJson,
  assertStdout,
  assertStderrEmpty,
  defineScenario,
  defineScenarioSuite,
  runBuiltCliStep,
  runCliStep,
  seedHome,
  writeFile,
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
const FLOW_STREAM_WORKFLOW_ID = "wf-json-watch-stream";
const FLOW_STREAM_SCOPE = 12345n;
const FLOW_STREAM_TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SUBMITTED_TX_STATUS_RECORD = {
  schemaVersion: "1",
  submissionId: "sub-json-status-submitted",
  createdAt: "2026-04-18T12:00:00.000Z",
  updatedAt: "2026-04-18T12:05:00.000Z",
  operation: "broadcast",
  sourceCommand: "broadcast",
  chain: "sepolia",
  asset: null,
  poolAccountId: "PA-9",
  poolAccountNumber: 9,
  workflowId: null,
  recipient: null,
  broadcastMode: "onchain",
  broadcastSourceOperation: "withdraw",
  status: "submitted",
  transactions: [
    {
      index: 0,
      description: "Broadcast relayed withdrawal",
      txHash: "0x9999999999999999999999999999999999999999999999999999999999999999",
      explorerUrl: null,
      blockNumber: null,
      status: "submitted",
    },
  ],
  reconciliationRequired: false,
  localStateSynced: false,
  warningCode: null,
  lastError: null,
};
const CONFIRMED_TX_STATUS_RECORD = {
  schemaVersion: "1",
  submissionId: "sub-json-status-confirmed",
  createdAt: "2026-04-18T12:00:00.000Z",
  updatedAt: "2026-04-18T12:10:00.000Z",
  operation: "withdraw",
  sourceCommand: "withdraw",
  chain: "sepolia",
  asset: "ETH",
  poolAccountId: "PA-3",
  poolAccountNumber: 3,
  workflowId: null,
  recipient: "0x7777777777777777777777777777777777777777",
  broadcastMode: null,
  broadcastSourceOperation: null,
  status: "confirmed",
  transactions: [
    {
      index: 0,
      description: "Relayed withdrawal",
      txHash: "0x8888888888888888888888888888888888888888888888888888888888888888",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x8888",
      blockNumber: "12345",
      status: "confirmed",
    },
  ],
  reconciliationRequired: false,
  localStateSynced: true,
  warningCode: null,
  lastError: null,
};
let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await launchFixtureServer();
});

afterAll(async () => {
  await killFixtureServer(fixture);
});

function fixtureEnv() {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
  };
}

function commitment(
  label: bigint,
  hash: bigint,
  value: bigint,
  blockNumber: bigint,
  txHash: `0x${string}`,
) {
  return {
    label,
    hash,
    value,
    blockNumber,
    txHash,
    nullifier: (label + 1000n) as any,
    secret: (label + 2000n) as any,
  };
}

function seedFlowWatchStreamState() {
  return (ctx: { home: string; useConfigHome: () => string }) => {
    ctx.useConfigHome();

    const cachedCommitment = commitment(
      1n,
      11n,
      9_950_000_000_000_000n,
      12345n,
      FLOW_STREAM_TX_HASH,
    );

    saveAccount(CHAINS.sepolia.id, {
      masterKeys: [1n, 2n],
      poolAccounts: new Map([
        [
          FLOW_STREAM_SCOPE,
          [
            {
              label: cachedCommitment.label as any,
              deposit: cachedCommitment,
              children: [],
            },
          ],
        ],
      ]),
      __legacyPoolAccounts: new Map(),
      __legacyMigrationReadinessStatus: "no_legacy",
    });

    writeWorkflowSnapshot(ctx.home, FLOW_STREAM_WORKFLOW_ID, {
      phase: "awaiting_asp",
      chain: "sepolia",
      asset: "ETH",
      assetDecimals: 18,
      depositAmount: "10000000000000000",
      recipient: "0x4444444444444444444444444444444444444444",
      walletMode: "configured",
      poolAccountId: "PA-1",
      poolAccountNumber: 1,
      depositTxHash: FLOW_STREAM_TX_HASH,
      depositBlockNumber: "12345",
      depositLabel: "1",
      committedValue: "10000000000000000",
      aspStatus: "pending",
    });
  };
}

function assertFlowWatchStreamOutput() {
  return assertStdout((stdout) => {
    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const phaseChange = JSON.parse(lines[0]!);
    expect(phaseChange).toMatchObject({
      schemaVersion: JSON_SCHEMA_VERSION,
      success: true,
      mode: "flow",
      action: "watch",
      event: "phase_change",
      workflowId: FLOW_STREAM_WORKFLOW_ID,
      previousPhase: "awaiting_asp",
      phase: "stopped_external",
    });
    expect(typeof phaseChange.ts).toBe("string");

    const finalSnapshot = JSON.parse(lines[1]!);
    expect(finalSnapshot).toMatchObject({
      schemaVersion: JSON_SCHEMA_VERSION,
      success: true,
      mode: "flow",
      action: "watch",
      workflowId: FLOW_STREAM_WORKFLOW_ID,
      phase: "stopped_external",
      chain: "sepolia",
      asset: "ETH",
      poolAccountId: "PA-1",
    });
    expect(finalSnapshot.event).toBeUndefined();
  });
}

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
        "withdraw quote <amount> <asset>",
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
    runBuiltCliStep(["--json", "upgrade", "--check"], {
      binPath: "scripts/start-built-cli.mjs",
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
      externalGuidance?: { kind: string; message: string; command?: string | null };
      nextActions?: unknown[];
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
      expect(json.externalGuidance?.kind).toBe("manual_install");
      expect(json.externalGuidance?.command).toBe(
        "npm install -g privacy-pools-cli@9.9.9",
      );
      expect(json.externalGuidance?.message).toContain("source checkout");
      expect(json.nextActions).toBeUndefined();
    }),
  ]),
  defineScenario("flow watch rejects agent mode with machine nextActions", [
    runCliStep(["--agent", "flow", "watch", "latest"], {
      timeoutMs: 10_000,
    }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      error: {
        category: string;
        nextActions?: Array<{
          command: string;
          when: string;
          runnable?: boolean;
          parameters?: Array<{ name: string }>;
        }>;
      };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_AGENT_FLOW_WATCH_UNSUPPORTED");
      expect(json.error.category).toBe("INPUT");
      expect(json.error.nextActions?.map((action) => action.command)).toEqual([
        "flow status",
        "flow step",
      ]);
      expect(json.error.nextActions?.map((action) => action.when)).toEqual([
        "transfer_resume",
        "transfer_resume",
      ]);
      expect(json.error.nextActions?.every((action) => action.runnable === false)).toBe(
        true,
      );
      expect(
        json.error.nextActions?.every(
          (action) => action.parameters?.[0]?.name === "workflowId",
        ),
      ).toBe(true);
    }),
  ]),
  defineScenario("accounts watch rejects agent mode with machine nextActions", [
    runCliStep(["--agent", "accounts", "--watch", "--pending-only"], {
      timeoutMs: 10_000,
    }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      error: {
        category: string;
        nextActions?: Array<{
          command: string;
          when: string;
          runnable?: boolean;
          options?: { pendingOnly?: boolean };
          cliCommand?: string;
        }>;
      };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_AGENT_ACCOUNTS_WATCH_UNSUPPORTED");
      expect(json.error.category).toBe("INPUT");
      expect(json.error.nextActions).toHaveLength(1);
      expect(json.error.nextActions?.[0]).toMatchObject({
        command: "accounts",
        when: "has_pending",
        options: {
          pendingOnly: true,
        },
        cliCommand: "privacy-pools accounts --agent --pending-only",
      });
      expect(json.error.nextActions?.[0]?.runnable).toBeUndefined();
    }),
  ]),
  defineScenario("flow start --watch rejects agent mode with machine nextActions", [
    runCliStep(
      [
        "--agent",
        "flow",
        "start",
        "0.1",
        "ETH",
        "--to",
        "0x4444444444444444444444444444444444444444",
        "--watch",
      ],
      {
        timeoutMs: 10_000,
      },
    ),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      error: {
        category: string;
        nextActions?: Array<{
          command: string;
          when: string;
          runnable?: boolean;
          parameters?: Array<{ name: string }>;
        }>;
      };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_AGENT_FLOW_WATCH_UNSUPPORTED");
      expect(json.error.category).toBe("INPUT");
      expect(json.error.nextActions?.map((action) => action.command)).toEqual([
        "flow status",
        "flow step",
      ]);
      expect(json.error.nextActions?.every((action) => action.runnable === false)).toBe(
        true,
      );
    }),
  ]),
  defineScenario("tx-status keeps the submitted polling JSON contract", [
    writeFile(
      ".privacy-pools/submissions/sub-json-status-submitted.json",
      `${JSON.stringify(SUBMITTED_TX_STATUS_RECORD, null, 2)}\n`,
    ),
    (ctx) =>
      runCliStep(["--agent", "tx-status", "sub-json-status-submitted"], {
        timeoutMs: 10_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      operation: string;
      submissionId: string;
      sourceOperation: string;
      sourceCommand: string;
      broadcastSourceOperation: string | null;
      status: string;
      transactions: Array<{ status: string; explorerUrl: string | null }>;
      nextActions?: Array<{
        command: string;
        when: string;
        args?: string[];
        cliCommand?: string;
      }>;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.operation).toBe("tx-status");
      expect(json.submissionId).toBe("sub-json-status-submitted");
      expect(json.sourceOperation).toBe("broadcast");
      expect(json.sourceCommand).toBe("broadcast");
      expect(json.broadcastSourceOperation).toBe("withdraw");
      expect(json.status).toBe("submitted");
      expect(json.transactions[0]?.status).toBe("submitted");
      expect(json.transactions[0]?.explorerUrl).toBe(
        "https://sepolia.etherscan.io/tx/0x9999999999999999999999999999999999999999999999999999999999999999",
      );
      expect(json.nextActions).toHaveLength(1);
      expect(json.nextActions?.[0]).toMatchObject({
        command: "tx-status",
        when: "after_submit",
        args: ["sub-json-status-submitted"],
        cliCommand:
          "privacy-pools tx-status sub-json-status-submitted --agent",
      });
    }),
  ]),
  defineScenario("tx-status keeps the confirmed follow-up contract", [
    writeFile(
      ".privacy-pools/submissions/sub-json-status-confirmed.json",
      `${JSON.stringify(CONFIRMED_TX_STATUS_RECORD, null, 2)}\n`,
    ),
    runCliStep(["--agent", "tx-status", "sub-json-status-confirmed"], {
      timeoutMs: 10_000,
    }),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      operation: string;
      submissionId: string;
      sourceOperation: string;
      workflowId: string | null;
      status: string;
      transactions: Array<{ status: string; blockNumber: string | null }>;
      nextActions?: Array<{
        command: string;
        when: string;
        args?: string[];
        cliCommand?: string;
      }>;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.operation).toBe("tx-status");
      expect(json.submissionId).toBe("sub-json-status-confirmed");
      expect(json.sourceOperation).toBe("withdraw");
      expect(json.workflowId).toBeNull();
      expect(json.status).toBe("confirmed");
      expect(json.transactions[0]?.status).toBe("confirmed");
      expect(json.transactions[0]?.blockNumber).toBe("12345");
      expect(json.nextActions).toHaveLength(1);
      expect(json.nextActions?.[0]).toMatchObject({
        command: "accounts",
        when: "after_withdraw",
        cliCommand: "privacy-pools accounts --agent --chain sepolia",
      });
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
    assertExit(8),
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
      expect(json.errorCode).toBe("INPUT_MISSING_ASSET");
      expect(json.errorMessage).toBe(
        "Missing asset argument.",
      );
      expect(json.error.category).toBe("INPUT");
      expect(json.error.code).toBe("INPUT_MISSING_ASSET");
      expect(json.error.hint).toContain("pool-stats ETH");
    }),
  ]),
  defineScenario("init keeps the semantic setup contract", [
    (ctx) =>
      runCliStep(
        [
          "--json",
          "init",
          "--default-chain",
          "sepolia",
          "--show-recovery-phrase",
          "--yes",
        ],
        { timeoutMs: 30_000 },
      )(ctx),
    assertExit(0),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      setupMode: string;
      readiness: string;
      defaultChain: string;
      signerKeySet: boolean;
      recoveryPhrase?: string;
      nextActions?: Array<{ command: string; runnable?: boolean }>;
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.setupMode).toBe("create");
      expect(json.readiness).toBe("read_only");
      expect(json.defaultChain).toBe("sepolia");
      expect(json.signerKeySet).toBe(false);
      expect(typeof json.recoveryPhrase).toBe("string");
      expect(json.nextActions?.[0]).toMatchObject({
        command: "init",
        runnable: false,
      });
      expect(json.nextActions?.[1]?.command).toBe("status");
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
      warnings?: Array<{
        code: string;
        category: string;
        message: string;
        suggestedRoundAmount?: string;
      }>;
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
          code: "PRIVACY_NONROUND_AMOUNT",
          category: "privacy",
          message:
            "This saved flow will auto-withdraw the full 99.5 USDC. That pattern can make the withdrawal more identifiable even though the protocol breaks the direct onchain link. Consider manual round partial withdrawals such as 99 USDC if you want better amount privacy.",
          suggestedRoundAmount: "99",
        },
      ]);
      expect(json.nextActions).toHaveLength(1);
      expect(json.nextActions?.[0]).toMatchObject({
        command: "flow status",
        when: "transfer_resume",
        args: ["wf-json-flow"],
        cliCommand: "privacy-pools flow status wf-json-flow --agent",
      });
      expect(json.nextActions?.[0]?.reason).toContain(
        "This workflow is holding until",
      );
      expect(json.nextActions?.[0]?.reason).toContain(
        "before requesting the relayed private withdrawal.",
      );
    }),
  ]),
  defineScenario("flow watch --json streams phase changes before the final snapshot", [
    seedHome("sepolia"),
    seedFlowWatchStreamState(),
    (ctx) =>
      runCliStep(["--json", "flow", "watch", FLOW_STREAM_WORKFLOW_ID], {
        timeoutMs: 10_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertFlowWatchStreamOutput(),
  ]),
  defineScenario("flow watch --stream-json exposes the same NDJSON contract", [
    seedHome("sepolia"),
    seedFlowWatchStreamState(),
    (ctx) =>
      runCliStep(["flow", "watch", FLOW_STREAM_WORKFLOW_ID, "--stream-json"], {
        timeoutMs: 10_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertFlowWatchStreamOutput(),
  ]),
]);
