import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import {
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

function writeWorkflow(
  home: string,
  workflow: Record<string, unknown>,
): void {
  const workflowDir = join(home, ".privacy-pools", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    join(workflowDir, `${workflow.workflowId as string}.json`),
    JSON.stringify(workflow, null, 2),
    "utf-8",
  );
}

describe("flow command", () => {
  test("flow start requires --to", () => {
    const result = runCli(["--json", "flow", "start", "0.1", "ETH"], {
      home: createTempHome(),
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint?: string };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toBe("Missing required --to <address>.");
    expect(json.error.hint).toContain("privacy-pools flow start <amount> <asset> --to");
  });

  test("flow start rejects --export-new-wallet without --new-wallet", () => {
    const result = runCli(
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
      {
        home: createTempHome(),
        timeoutMs: 10_000,
      },
    );

    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint?: string };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toBe("--export-new-wallet requires --new-wallet.");
    expect(json.error.hint).toContain("--new-wallet");
  });

  test("flow status errors cleanly when no saved workflow exists", () => {
    const result = runCli(["--json", "flow", "status"], {
      home: createTempHome(),
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toContain("No saved workflows found");
  });

  test("flow watch errors cleanly when no saved workflow exists", () => {
    const result = runCli(["--json", "flow", "watch"], {
      home: createTempHome(),
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toContain("No saved workflows found");
  });

  test("flow status returns the saved snapshot contract and canonical next action", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-123",
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
    });

    const result = runCli(["--json", "flow", "status", "wf-123"], {
      home,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      mode: string;
      action: string;
      workflowId: string;
      phase: string;
      nextActions: Array<{ command: string; options?: Record<string, string> }>;
    }>(result.stdout);

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
  });

  test("flow status latest resolves the newest saved workflow", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-older",
      createdAt: "2026-03-24T12:00:00.000Z",
      updatedAt: "2026-03-24T12:00:00.000Z",
      phase: "awaiting_asp",
      chain: "sepolia",
      asset: "ETH",
      depositAmount: "10000000000000000",
      recipient: "0x4444444444444444444444444444444444444444",
    });
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-latest",
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
    });

    const result = runCli(["--json", "flow", "status", "latest"], {
      home,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      workflowId: string;
      phase: string;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.workflowId).toBe("wf-latest");
    expect(json.phase).toBe("paused_declined");
  });

  test("flow watch latest returns the newest saved terminal workflow", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-older",
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
    });
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-latest",
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
    });

    const result = runCli(["--json", "flow", "watch", "latest"], {
      home,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      workflowId: string;
      phase: string;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.workflowId).toBe("wf-latest");
    expect(json.phase).toBe("completed");
  });

  test("flow ragequit latest resolves the newest saved workflow before validation", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-older",
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
    });
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-latest",
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
    });

    const result = runCli(["--json", "flow", "ragequit", "latest"], {
      home,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toContain("already terminal");
  });

  test("capabilities and describe expose the flow commands", () => {
    const home = createTempHome();
    const capabilitiesResult = runCli(["--json", "capabilities"], {
      home,
      timeoutMs: 10_000,
    });
    expect(capabilitiesResult.status).toBe(0);

    const capabilities = parseJsonOutput<{
      success: boolean;
      commands: Array<{ name: string }>;
      commandDetails: Record<string, { command: string }>;
    }>(capabilitiesResult.stdout);

    expect(capabilities.success).toBe(true);
    expect(capabilities.commands.map((command) => command.name)).toContain("flow");
    expect(capabilities.commands.map((command) => command.name)).toContain("flow start");
    expect(capabilities.commands.map((command) => command.name)).toContain("flow watch");
    expect(capabilities.commands.map((command) => command.name)).toContain("flow status");
    expect(capabilities.commands.map((command) => command.name)).toContain("flow ragequit");
    expect(capabilities.commandDetails["flow start"]?.command).toBe("flow start");

    const describeResult = runCli(["--json", "describe", "flow", "start"], {
      home,
      timeoutMs: 10_000,
    });
    expect(describeResult.status).toBe(0);
    const descriptor = parseJsonOutput<{
      success: boolean;
      command: string;
      usage: string;
      flags: string[];
    }>(describeResult.stdout);

    expect(descriptor.success).toBe(true);
    expect(descriptor.command).toBe("flow start");
    expect(descriptor.usage).toBe("flow start <amount> <asset> --to <address>");
    expect(descriptor.flags).toEqual([
      "--to <address>",
      "--watch",
      "--new-wallet",
      "--export-new-wallet <path>",
    ]);
  });
});
