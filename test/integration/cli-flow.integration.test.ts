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

function buildFlowSnapshot(
  workflowId: string,
  phase: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowId,
    createdAt: "2026-03-24T12:00:00.000Z",
    updatedAt: "2026-03-24T12:00:00.000Z",
    phase,
    chain: "sepolia",
    asset: "ETH",
    assetDecimals: 18,
    depositAmount: "10000000000000000",
    recipient: "0x4444444444444444444444444444444444444444",
    ...overrides,
  };
}

function expectFlowStatusAgentContract(
  home: string,
  workflowId: string,
  phase: string,
  expectedNextActions:
    | null
    | Array<{
        command: string;
        when: string;
        runnable?: boolean;
        args?: string[];
        options?: Record<string, boolean | string>;
      }> = null,
): void {
  const result = runCli(["--agent", "flow", "status", workflowId], {
    home,
    timeoutMs: 10_000,
  });

  expect(result.status).toBe(0);
  expect(result.stderr.trim()).toBe("");

  const json = parseJsonOutput<{
    success: boolean;
    mode: string;
    action: string;
    workflowId: string;
    phase: string;
    nextActions?: Array<{
      command: string;
      when: string;
      args?: string[];
      options?: Record<string, boolean | string>;
    }>;
  }>(result.stdout);

  expect(json.success).toBe(true);
  expect(json.mode).toBe("flow");
  expect(json.action).toBe("status");
  expect(json.workflowId).toBe(workflowId);
  expect(json.phase).toBe(phase);

  if (!expectedNextActions) {
    expect(json.nextActions ?? []).toEqual([]);
    return;
  }

  expect(json.nextActions).toEqual(
    expectedNextActions.map((expectedNextAction) => ({
      command: expectedNextAction.command,
      reason: expect.any(String),
      when: expectedNextAction.when,
      ...(expectedNextAction.args === undefined
        ? { args: [workflowId] }
        : expectedNextAction.args.length > 0
          ? { args: expectedNextAction.args }
          : {}),
      options: expectedNextAction.options ?? { agent: true },
      ...(expectedNextAction.runnable === false ? { runnable: false } : {}),
    })),
  );
}

describe("flow command", () => {
  const statusPhaseCases = [
    {
      phase: "awaiting_funding",
      expectedNextActions: [{ command: "flow watch", when: "flow_resume" }],
      overrides: {
        walletMode: "new_wallet",
        walletAddress: "0x5555555555555555555555555555555555555555",
        requiredNativeFunding: "10000000000000000",
      },
    },
    {
      phase: "depositing_publicly",
      expectedNextActions: [{ command: "flow watch", when: "flow_resume" }],
      overrides: {
        walletMode: "new_wallet",
        walletAddress: "0x5555555555555555555555555555555555555555",
        requiredNativeFunding: "10000000000000000",
      },
    },
    {
      phase: "awaiting_asp",
      expectedNextActions: [{ command: "flow watch", when: "flow_resume" }],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "pending",
      },
    },
    {
      phase: "approved_waiting_privacy_delay",
      expectedNextActions: [{ command: "flow watch", when: "flow_resume" }],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "approved",
        privacyDelayProfile: "balanced",
        privacyDelayUntil: "2026-03-24T13:00:00.000Z",
      },
    },
    {
      phase: "approved_ready_to_withdraw",
      expectedNextActions: [{ command: "flow watch", when: "flow_resume" }],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "approved",
      },
    },
    {
      phase: "withdrawing",
      expectedNextActions: [{ command: "flow watch", when: "flow_resume" }],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "approved",
      },
    },
    {
      phase: "completed",
      expectedNextActions: null,
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "approved",
        withdrawTxHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        withdrawBlockNumber: "12399",
      },
    },
    {
      phase: "completed_public_recovery",
      expectedNextActions: null,
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "declined",
        ragequitTxHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        ragequitBlockNumber: "12400",
      },
    },
    {
      phase: "paused_declined",
      expectedNextActions: [{ command: "flow ragequit", when: "flow_declined" }],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "declined",
      },
    },
    {
      phase: "paused_poi_required",
      expectedNextActions: [
        { command: "flow watch", when: "flow_resume", runnable: false },
        { command: "flow ragequit", when: "flow_public_recovery_optional" },
      ],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "poi_required",
      },
    },
    {
      phase: "stopped_external",
      expectedNextActions: [
        {
          command: "accounts",
          when: "flow_manual_followup",
          args: [],
          options: { agent: true, chain: "sepolia" },
        },
      ],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "approved",
      },
    },
  ] as const;

  for (const { phase, expectedNextActions, overrides } of statusPhaseCases) {
    test(`flow status keeps ${phase} machine-readable and phase-stable`, () => {
      const home = createTempHome();
      const workflowId = `wf-${phase}`;
      writeWorkflow(home, buildFlowSnapshot(workflowId, phase, overrides));
      expectFlowStatusAgentContract(home, workflowId, phase, expectedNextActions);
    });
  }

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
      nextActions: Array<{
        command: string;
        reason: string;
        when: string;
        args?: string[];
        options?: Record<string, boolean | string>;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.mode).toBe("flow");
    expect(json.action).toBe("status");
    expect(json.workflowId).toBe("wf-123");
    expect(json.phase).toBe("paused_declined");
    expect(json.nextActions).toEqual([
      {
        command: "flow ragequit",
        reason: expect.stringContaining(
          "canonical saved-workflow public recovery path",
        ),
        when: "flow_declined",
        args: ["wf-123"],
        options: { agent: true },
      },
    ]);
  });

  test("flow status surfaces saved privacy delay metadata and warnings", () => {
    const home = createTempHome();
    writeWorkflow(
      home,
      buildFlowSnapshot("wf-delay", "approved_waiting_privacy_delay", {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "approved",
        committedValue: "100198474800000000000",
        privacyDelayProfile: "off",
        privacyDelayUntil: "2026-03-24T12:45:00.000Z",
        privacyDelayConfigured: true,
      }),
    );

    const result = runCli(["--json", "flow", "status", "wf-delay"], {
      home,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      phase: string;
      privacyDelayProfile: string;
      privacyDelayConfigured: boolean;
      privacyDelayUntil?: string | null;
      backupConfirmed?: boolean;
      warnings?: Array<{ code: string; category: string; message: string }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.phase).toBe("approved_waiting_privacy_delay");
    expect(json.privacyDelayProfile).toBe("off");
    expect(json.privacyDelayConfigured).toBe(true);
    expect(json.privacyDelayUntil).toBe("2026-03-24T12:45:00.000Z");
    expect(json.backupConfirmed).toBeUndefined();
    expect(json.warnings?.map((warning) => warning.code)).toEqual([
      "timing_delay_disabled",
      "amount_pattern_linkability",
    ]);
    expect(json.warnings?.every((warning) => warning.category === "privacy")).toBe(
      true,
    );
  });

  test("flow status normalizes legacy workflows without saved privacy-delay fields", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      workflowId: "wf-legacy",
      createdAt: "2026-03-24T12:00:00.000Z",
      updatedAt: "2026-03-24T12:00:00.000Z",
      phase: "awaiting_asp",
      chain: "sepolia",
      asset: "ETH",
      assetDecimals: 18,
      depositAmount: "10000000000000000",
      recipient: "0x4444444444444444444444444444444444444444",
      poolAccountId: "PA-1",
      poolAccountNumber: 1,
      depositTxHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      depositBlockNumber: "12345",
      depositExplorerUrl: "https://example.test/deposit",
      committedValue: "9950000000000000",
      aspStatus: "pending",
    });

    const result = runCli(["--json", "flow", "status", "wf-legacy"], {
      home,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      privacyDelayProfile: string;
      privacyDelayConfigured: boolean;
      privacyDelayUntil?: string | null;
      warnings?: Array<{ code: string }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.privacyDelayProfile).toBe("off");
    expect(json.privacyDelayConfigured).toBe(false);
    expect(json.privacyDelayUntil).toBeNull();
    expect(json.warnings?.map((warning) => warning.code)).toEqual([
      "amount_pattern_linkability",
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
      nextActions?: Array<{
        command: string;
        when: string;
        args?: string[];
        options?: Record<string, boolean | string>;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.workflowId).toBe("wf-latest");
    expect(json.phase).toBe("paused_declined");
    expect(json.nextActions).toEqual([
      {
        command: "flow ragequit",
        reason: expect.any(String),
        when: "flow_declined",
        args: ["wf-latest"],
        options: { agent: true },
      },
    ]);
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
      nextActions?: unknown[];
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.workflowId).toBe("wf-latest");
    expect(json.phase).toBe("completed");
    expect(json.nextActions ?? []).toEqual([]);
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
      "--privacy-delay <profile>",
      "--watch",
      "--new-wallet",
      "--export-new-wallet <path>",
    ]);
  });
});
