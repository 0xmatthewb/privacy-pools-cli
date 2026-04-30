import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import {
  createSeededHome,
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
      reasonContains: string;
      when: string;
      runnable?: boolean;
      args?: string[];
      options?: Record<string, string>;
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
    operation: string;
    workflowId: string;
    phase: string;
    nextActions?: Array<{
      command: string;
      when: string;
      args?: string[];
      cliCommand?: string;
      options?: Record<string, string>;
    }>;
  }>(result.stdout);

  expect(json.success).toBe(true);
  expect(json.mode).toBe("transfer");
  expect(json.action).toBe("status");
  expect(json.operation).toBe("transfer.status");
  expect(json.workflowId).toBe(workflowId);
  expect(json.phase).toBe(phase);

  if (!expectedNextActions) {
    expect(json.nextActions ?? []).toEqual([]);
    return;
  }

  expect(json.nextActions).toHaveLength(expectedNextActions.length);
  for (const [index, expectedNextAction] of expectedNextActions.entries()) {
    const actual = json.nextActions?.[index];
    expect(actual).toMatchObject({
      command: expectedNextAction.command,
      reason: expect.stringContaining(expectedNextAction.reasonContains),
      when: expectedNextAction.when,
      ...(expectedNextAction.args === undefined
        ? { args: [workflowId] }
        : expectedNextAction.args.length > 0
          ? { args: expectedNextAction.args }
          : {}),
      ...(expectedNextAction.options === undefined
        ? {}
        : { options: expectedNextAction.options }),
      ...(expectedNextAction.runnable === false ? { runnable: false } : {}),
    });
    expect(actual?.cliCommand).toContain(`privacy-pools ${expectedNextAction.command}`);
    expect(actual?.cliCommand).toContain("--agent");
    expect(
      Object.prototype.hasOwnProperty.call(actual?.options ?? {}, "agent"),
    ).toBe(false);
  }
}

describe("flow command", () => {
  const statusPhaseCases = [
    {
      phase: "awaiting_funding",
      expectedNextActions: [
        {
          command: "flow status",
          reasonContains: "Fund the dedicated workflow wallet",
          when: "transfer_resume",
        },
        {
          command: "flow step",
          reasonContains: "Attempt the next saved-workflow step",
          when: "transfer_resume",
        },
      ],
      overrides: {
        walletMode: "new_wallet",
        walletAddress: "0x5555555555555555555555555555555555555555",
        requiredNativeFunding: "10000000000000000",
      },
    },
    {
      phase: "depositing_publicly",
      expectedNextActions: [
        {
          command: "flow status",
          reasonContains: "public deposit confirms",
          when: "transfer_resume",
        },
        {
          command: "flow step",
          reasonContains: "Advance the saved workflow one unit of work",
          when: "transfer_resume",
        },
      ],
      overrides: {
        walletMode: "new_wallet",
        walletAddress: "0x5555555555555555555555555555555555555555",
        requiredNativeFunding: "10000000000000000",
      },
    },
    {
      phase: "awaiting_asp",
      expectedNextActions: [
        {
          command: "flow status",
          reasonContains: "ASP review resolves",
          when: "transfer_resume",
        },
      ],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "pending",
      },
    },
    {
      phase: "approved_waiting_privacy_delay",
      expectedNextActions: [
        {
          command: "flow status",
          reasonContains: "holding until",
          when: "transfer_resume",
        },
      ],
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
      expectedNextActions: [
        {
          command: "flow status",
          reasonContains: "before advancing the private withdrawal",
          when: "transfer_resume",
        },
        {
          command: "flow step",
          reasonContains: "Advance the saved workflow into the private withdrawal",
          when: "transfer_resume",
        },
      ],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "approved",
      },
    },
    {
      phase: "withdrawing",
      expectedNextActions: [
        {
          command: "flow status",
          reasonContains: "while the private withdrawal is still confirming",
          when: "transfer_resume",
        },
        {
          command: "flow step",
          reasonContains: "Advance the saved workflow one unit of work",
          when: "transfer_resume",
        },
      ],
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
      expectedNextActions: [
        {
          command: "flow ragequit",
          reasonContains: "canonical saved-workflow public recovery path",
          when: "transfer_declined",
        },
      ],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "declined",
      },
    },
    {
      phase: "paused_poa_required",
      expectedNextActions: [
        {
          command: "flow status",
          reasonContains: "Complete Proof of Association",
          when: "transfer_resume",
        },
        {
          command: "flow ragequit",
          reasonContains: "recover publicly without completing Proof of Association",
          when: "transfer_ragequit_optional",
        },
      ],
      overrides: {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        aspStatus: "poa_required",
      },
    },
    {
      phase: "stopped_external",
      expectedNextActions: [
        {
          command: "accounts",
          reasonContains: "choose the manual follow-up from the current account state",
          when: "transfer_manual_followup",
          args: [],
          options: { chain: "sepolia" },
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
    expect(json.errorCode).toBe("INPUT_MISSING_RECIPIENT");
    expect(json.errorMessage).toBe(
      "Missing required --to <address> in non-interactive mode.",
    );
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

  test("flow start rejects non-interactive new-wallet flows without an export backup", () => {
    const home = createSeededHome("mainnet");
    const result = runCli(
      [
        "--json",
        "flow",
        "start",
        "0.1",
        "ETH",
        "--to",
        "0x4444444444444444444444444444444444444444",
        "--new-wallet",
      ],
      {
        home,
        timeoutMs: 20_000,
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
    expect(json.errorMessage).toBe(
      "Non-interactive workflow wallets require --export-new-wallet <path>.",
    );
    expect(json.error.hint).toContain("backed up before the flow starts");

    const workflowDir = join(home, ".privacy-pools", "workflows");
    const secretsDir = join(home, ".privacy-pools", "workflow-secrets");
    expect(existsSync(workflowDir) ? readdirSync(workflowDir) : []).toEqual([]);
    expect(existsSync(secretsDir) ? readdirSync(secretsDir) : []).toEqual([]);
  });

  test("flow start rejects non-round amounts in machine mode", () => {
    const home = createSeededHome("mainnet");
    const result = runCli(
      [
        "--json",
        "flow",
        "start",
        "0.011",
        "ETH",
        "--to",
        "0x4444444444444444444444444444444444444444",
      ],
      {
        home,
        timeoutMs: 20_000,
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
    expect(json.errorCode).toBe("INPUT_NONROUND_AMOUNT");
    expect(json.errorMessage).toBe(
      "Non-round amount 0.011 ETH may reduce privacy.",
    );
    expect(json.error.hint).toContain(
      "That pattern can make later withdrawals more identifiable",
    );
  });

  test("flow start accepts non-round dry-run amounts with explicit override", () => {
    const home = createSeededHome("mainnet");
    const result = runCli(
      [
        "--json",
        "flow",
        "start",
        "0.011",
        "ETH",
        "--to",
        "0x4444444444444444444444444444444444444444",
        "--dry-run",
        "--allow-non-round-amounts",
      ],
      {
        home,
        timeoutMs: 20_000,
      },
    );

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      dryRun: boolean;
      warnings?: Array<{ code: string }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.warnings?.some((warning) => warning.code === "PRIVACY_NONROUND_AMOUNT")).toBe(true);
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
    expect(json.errorCode).toBe("INPUT_NO_SAVED_WORKFLOWS");
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
    expect(json.errorCode).toBe("INPUT_NO_SAVED_WORKFLOWS");
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
      operation: string;
      workflowId: string;
      phase: string;
      nextActions: Array<{
        command: string;
        reason: string;
        when: string;
        args?: string[];
        options?: Record<string, string>;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.mode).toBe("transfer");
    expect(json.action).toBe("status");
    expect(json.operation).toBe("transfer.status");
    expect(json.workflowId).toBe("wf-123");
    expect(json.phase).toBe("paused_declined");
    expect(json.nextActions).toHaveLength(1);
    expect(json.nextActions?.[0]).toMatchObject({
      command: "flow ragequit",
      reason: expect.stringContaining(
        "canonical saved-workflow public recovery path",
      ),
      when: "transfer_declined",
      args: ["wf-123"],
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        json.nextActions?.[0]?.options ?? {},
        "agent",
      ),
    ).toBe(false);
    expect(json.nextActions?.[0]?.cliCommand).toBe(
      "privacy-pools flow ragequit wf-123 --agent",
    );
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
      "PRIVACY_NONROUND_AMOUNT",
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
      "PRIVACY_NONROUND_AMOUNT",
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
        options?: Record<string, string>;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.workflowId).toBe("wf-latest");
    expect(json.phase).toBe("paused_declined");
    expect(json.nextActions).toHaveLength(1);
    expect(json.nextActions?.[0]).toMatchObject({
      command: "flow ragequit",
      reason: expect.stringContaining(
        "canonical saved-workflow public recovery path",
      ),
      when: "transfer_declined",
      args: ["wf-latest"],
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        json.nextActions?.[0]?.options ?? {},
        "agent",
      ),
    ).toBe(false);
    expect(json.nextActions?.[0]?.cliCommand).toBe(
      "privacy-pools flow ragequit wf-latest --agent",
    );
  });

  test("flow status latest fails closed when an unreadable newer workflow exists", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-readable",
      createdAt: "2026-03-24T12:00:00.000Z",
      updatedAt: "2026-03-24T12:00:00.000Z",
      phase: "awaiting_asp",
      chain: "sepolia",
      asset: "ETH",
      depositAmount: "10000000000000000",
      recipient: "0x4444444444444444444444444444444444444444",
    });

    const workflowDir = join(home, ".privacy-pools", "workflows");
    writeFileSync(join(workflowDir, "wf-corrupt.json"), "{invalid", "utf-8");

    const result = runCli(["--json", "flow", "status", "latest"], {
      home,
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
    expect(json.errorCode).toBe("INPUT_WORKFLOW_LATEST_AMBIGUOUS_INVALID_FILES");
    expect(json.errorMessage).toContain("Cannot resolve 'latest'");
    expect(json.error.hint).toContain("explicit workflow id");
  });

  test("flow status hides tentative Pool Account ids before the public deposit is confirmed", () => {
    const home = createTempHome();
    writeWorkflow(
      home,
      buildFlowSnapshot("wf-awaiting-funding", "awaiting_funding", {
        walletMode: "new_wallet",
        walletAddress: "0x5555555555555555555555555555555555555555",
        requiredNativeFunding: "10000000000000000",
        poolAccountId: "PA-7",
        poolAccountNumber: 7,
        depositTxHash: null,
        depositBlockNumber: null,
        depositExplorerUrl: null,
        committedValue: null,
        aspStatus: undefined,
      }),
    );

    const result = runCli(["--json", "flow", "status", "wf-awaiting-funding"], {
      home,
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      success: boolean;
      poolAccountId?: string | null;
      poolAccountNumber?: number | null;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.poolAccountId).toBeNull();
    expect(json.poolAccountNumber).toBeNull();
  });

  test("flow status human output explains snapshot semantics and optional public recovery", () => {
    const home = createTempHome();
    writeWorkflow(
      home,
      buildFlowSnapshot("wf-human-status", "awaiting_asp", {
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        depositTxHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        depositBlockNumber: "12345",
        depositExplorerUrl: "https://example.test/deposit",
        committedValue: "9950000000000000",
        aspStatus: "pending",
      }),
    );

    const result = runCli(["flow", "status", "wf-human-status"], {
      home,
      timeoutMs: 10_000,
      env: { NO_COLOR: "1" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("saved local workflow snapshot");
    expect(result.stderr).toContain("Optional public recovery");
    expect(result.stderr).toContain("privacy-pools flow watch wf-human-status");
  });

  test("flow status human output suppresses optional public recovery for completed workflows", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-human-complete",
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
      depositTxHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      depositBlockNumber: "12345",
      depositExplorerUrl: "https://example.test/deposit",
      committedValue: "9950000000000000",
      aspStatus: "approved",
      withdrawTxHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      withdrawBlockNumber: "12399",
      withdrawExplorerUrl: "https://example.test/withdraw",
    });

    const result = runCli(["flow", "status", "wf-human-complete"], {
      home,
      timeoutMs: 10_000,
      env: { NO_COLOR: "1" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).not.toContain("Optional public recovery");
    expect(result.stderr).toContain("Withdrawal:");
    expect(result.stderr).toContain("https://example.test/withdraw");
  });

  test("flow status human output suppresses optional public recovery for externally stopped workflows", () => {
    const home = createTempHome();
    writeWorkflow(home, {
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-human-stopped-external",
      createdAt: "2026-03-24T12:00:00.000Z",
      updatedAt: "2026-03-24T12:00:00.000Z",
      phase: "stopped_external",
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
      aspStatus: "approved",
      lastError: {
        step: "reconcile",
        errorCode: "FLOW_STOPPED_EXTERNAL",
        errorMessage: "The saved Pool Account changed outside this workflow.",
        retryable: false,
        at: "2026-03-24T12:05:00.000Z",
      },
    });

    const result = runCli(["flow", "status", "wf-human-stopped-external"], {
      home,
      timeoutMs: 10_000,
      env: { NO_COLOR: "1" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).not.toContain("Optional public recovery");
    expect(result.stderr).toContain("Inspect accounts on sepolia");
    expect(result.stderr).toContain("privacy-pools accounts --chain sepolia");
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
    expect(capabilities.commandDetails["flow"]?.sideEffectClass).toBe("read_only");
    expect(capabilities.commandDetails["flow"]?.safeReadOnly).toBe(true);

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
      "--dry-run",
      "--watch",
      "--stream-json",
      "--allow-non-round-amounts",
      "--new-wallet",
      "--export-new-wallet <path>",
    ]);

    const describeFlowResult = runCli(["--json", "describe", "flow"], {
      home,
      timeoutMs: 10_000,
    });
    expect(describeFlowResult.status).toBe(0);
    const flowDescriptor = parseJsonOutput<{
      success: boolean;
      command: string;
      sideEffectClass: string;
      safeReadOnly: boolean;
      touchesFunds: boolean;
      requiresHumanReview: boolean;
    }>(describeFlowResult.stdout);

    expect(flowDescriptor.success).toBe(true);
    expect(flowDescriptor.command).toBe("flow");
    expect(flowDescriptor.sideEffectClass).toBe("read_only");
    expect(flowDescriptor.safeReadOnly).toBe(true);
    expect(flowDescriptor.touchesFunds).toBe(false);
    expect(flowDescriptor.requiresHumanReview).toBe(false);
  });
});
