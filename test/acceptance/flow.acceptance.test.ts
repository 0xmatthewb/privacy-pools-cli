import { expect } from "bun:test";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import {
  assertExit,
  assertJson,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  writeFile,
} from "./framework.ts";

function workflowFileStep(
  workflowId: string,
  workflow: Record<string, unknown>,
) {
  return writeFile(
    `.privacy-pools/workflows/${workflowId}.json`,
    JSON.stringify(
      {
        schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
        workflowId,
        ...workflow,
      },
      null,
      2,
    ),
  );
}

defineScenarioSuite("flow acceptance", [
  defineScenario("flow start requires --to", [
    runCliStep(["--json", "flow", "start", "0.1", "ETH"], {
      timeoutMs: 10_000,
    }),
    assertExit(2),
    assertJson<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint?: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.errorMessage).toBe("Missing required --to <address>.");
      expect(json.error.hint).toContain(
        "privacy-pools flow start <amount> <asset> --to",
      );
    }),
  ]),
  defineScenario("flow start rejects --export-new-wallet without --new-wallet", [
    runCliStep(
      [
        "--json",
        "flow",
        "start",
        "0.1",
        "ETH",
        "--to",
        "0x4444444444444444444444444444444444444444",
        "--export-new-wallet",
        "/tmp/flow-wallet.txt",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(2),
    assertJson<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint?: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.errorMessage).toBe(
        "--export-new-wallet requires --new-wallet.",
      );
      expect(json.error.hint).toContain("--new-wallet");
    }),
  ]),
  defineScenario("flow status errors cleanly when no saved workflow exists", [
    runCliStep(["--json", "flow", "status"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertJson<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.errorMessage).toContain("No saved workflows found");
    }),
  ]),
  defineScenario("flow watch errors cleanly when no saved workflow exists", [
    runCliStep(["--json", "flow", "watch"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertJson<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.errorMessage).toContain("No saved workflows found");
    }),
  ]),
  defineScenario(
    "flow status returns the saved snapshot contract and canonical next action",
    [
      workflowFileStep("wf-123", {
        createdAt: "2026-03-24T12:00:00.000Z",
        updatedAt: "2026-03-24T12:00:00.000Z",
        phase: "paused_declined",
        chain: "sepolia",
        asset: "ETH",
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        depositTxHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        depositBlockNumber: "12345",
        depositExplorerUrl: "https://example.test/deposit",
        committedValue: "9950000000000000",
        aspStatus: "declined",
      }),
      runCliStep(["--json", "flow", "status", "wf-123"], {
        timeoutMs: 10_000,
      }),
      assertExit(0),
      assertJson<{
        success: boolean;
        mode: string;
        action: string;
        workflowId: string;
        phase: string;
        nextActions: Array<{
          command: string;
          reason: string;
          when: string;
          args: string[];
          options: Record<string, boolean>;
        }>;
      }>((json) => {
        expect(json.success).toBe(true);
        expect(json.mode).toBe("flow");
        expect(json.action).toBe("status");
        expect(json.workflowId).toBe("wf-123");
        expect(json.phase).toBe("paused_declined");
        expect(json.nextActions).toEqual([
          {
            command: "flow ragequit",
            reason:
              "This workflow was declined. flow ragequit is the canonical saved-workflow recovery path.",
            when: "flow_declined",
            args: ["wf-123"],
            options: { agent: true },
          },
        ]);
      }),
    ],
  ),
  defineScenario("flow status latest resolves the newest saved workflow", [
    workflowFileStep("wf-older", {
      createdAt: "2026-03-24T12:00:00.000Z",
      updatedAt: "2026-03-24T12:00:00.000Z",
      phase: "awaiting_asp",
      chain: "sepolia",
      asset: "ETH",
      depositAmount: "10000000000000000",
      recipient: "0x4444444444444444444444444444444444444444",
    }),
    workflowFileStep("wf-latest", {
      createdAt: "2026-03-24T12:05:00.000Z",
      updatedAt: "2026-03-24T12:10:00.000Z",
      phase: "paused_declined",
      chain: "sepolia",
      asset: "ETH",
      depositAmount: "10000000000000000",
      recipient: "0x4444444444444444444444444444444444444444",
      poolAccountId: "PA-1",
      poolAccountNumber: 1,
      depositTxHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      depositBlockNumber: "12345",
      depositExplorerUrl: "https://example.test/deposit",
      committedValue: "9950000000000000",
      aspStatus: "declined",
    }),
    runCliStep(["--json", "flow", "status", "latest"], { timeoutMs: 10_000 }),
    assertExit(0),
    assertJson<{ success: boolean; workflowId: string; phase: string }>(
      (json) => {
        expect(json.success).toBe(true);
        expect(json.workflowId).toBe("wf-latest");
        expect(json.phase).toBe("paused_declined");
      },
    ),
  ]),
  defineScenario(
    "flow watch latest returns the newest saved terminal workflow",
    [
      workflowFileStep("wf-older", {
        createdAt: "2026-03-24T12:00:00.000Z",
        updatedAt: "2026-03-24T12:00:00.000Z",
        phase: "completed",
        chain: "sepolia",
        asset: "ETH",
        assetDecimals: 18,
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
      }),
      workflowFileStep("wf-latest", {
        createdAt: "2026-03-24T12:05:00.000Z",
        updatedAt: "2026-03-24T12:10:00.000Z",
        phase: "completed",
        chain: "sepolia",
        asset: "ETH",
        assetDecimals: 18,
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-2",
        poolAccountNumber: 2,
        withdrawTxHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        withdrawBlockNumber: "12399",
        withdrawExplorerUrl: "https://example.test/withdraw",
      }),
      runCliStep(["--json", "flow", "watch", "latest"], { timeoutMs: 10_000 }),
      assertExit(0),
      assertJson<{ success: boolean; workflowId: string; phase: string }>(
        (json) => {
          expect(json.success).toBe(true);
          expect(json.workflowId).toBe("wf-latest");
          expect(json.phase).toBe("completed");
        },
      ),
    ],
  ),
  defineScenario(
    "flow ragequit latest resolves the newest saved workflow before validation",
    [
      workflowFileStep("wf-older", {
        createdAt: "2026-03-24T12:00:00.000Z",
        updatedAt: "2026-03-24T12:00:00.000Z",
        phase: "paused_declined",
        chain: "sepolia",
        asset: "ETH",
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        depositTxHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      workflowFileStep("wf-latest", {
        createdAt: "2026-03-24T12:05:00.000Z",
        updatedAt: "2026-03-24T12:10:00.000Z",
        phase: "completed_public_recovery",
        chain: "sepolia",
        asset: "ETH",
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-2",
        poolAccountNumber: 2,
        depositTxHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        ragequitTxHash:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        ragequitBlockNumber: "12399",
        aspStatus: "declined",
      }),
      runCliStep(["--json", "flow", "ragequit", "latest"], {
        timeoutMs: 10_000,
      }),
      assertExit(2),
      assertJson<{
        success: boolean;
        errorCode: string;
        errorMessage: string;
      }>((json) => {
        expect(json.success).toBe(false);
        expect(json.errorCode).toBe("INPUT_ERROR");
        expect(json.errorMessage).toContain("already terminal");
      }),
    ],
  ),
  defineScenario("capabilities and describe expose the flow commands", [
    runCliStep(["--json", "capabilities"], { timeoutMs: 10_000 }),
    assertExit(0),
    assertJson<{
      success: boolean;
      commands: Array<{ name: string }>;
      commandDetails: Record<string, { command: string }>;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.commands.map((command) => command.name)).toContain("flow");
      expect(json.commands.map((command) => command.name)).toContain(
        "flow start",
      );
      expect(json.commands.map((command) => command.name)).toContain(
        "flow watch",
      );
      expect(json.commands.map((command) => command.name)).toContain(
        "flow status",
      );
      expect(json.commands.map((command) => command.name)).toContain(
        "flow ragequit",
      );
      expect(json.commandDetails["flow start"]?.command).toBe("flow start");
    }),
    runCliStep(["--json", "describe", "flow", "start"], {
      timeoutMs: 10_000,
    }),
    assertExit(0),
      assertJson<{
        success: boolean;
        command: string;
        usage: string;
        flags: string[];
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.command).toBe("flow start");
      expect(json.usage).toBe("flow start <amount> <asset> --to <address>");
      expect(json.flags).toEqual([
        "--to <address>",
        "--privacy-delay <profile>",
        "--watch",
        "--new-wallet",
        "--export-new-wallet <path>",
      ]);
    }),
  ]),
]);
