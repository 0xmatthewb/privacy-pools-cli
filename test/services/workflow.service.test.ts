import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";
import {
  getWorkflowStatus,
  loadWorkflowSnapshot,
  resolveLatestWorkflowId,
  type FlowSnapshot,
} from "../../src/services/workflow.ts";
import { CLIError } from "../../src/utils/errors.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

function isolatedHome(): string {
  const home = createTrackedTempDir("pp-workflow-service-test-");
  mkdirSync(join(home, "workflows"), { recursive: true });
  return home;
}

function sampleWorkflow(
  workflowId: string,
  patch: Partial<FlowSnapshot> = {},
): FlowSnapshot {
  const now = "2026-03-24T12:00:00.000Z";
  return {
    schemaVersion: "1.5.0",
    workflowId,
    createdAt: now,
    updatedAt: now,
    phase: "awaiting_asp",
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
    aspStatus: "pending",
    ...patch,
  };
}

function writeWorkflow(home: string, snapshot: FlowSnapshot): void {
  writeFileSync(
    join(home, "workflows", `${snapshot.workflowId}.json`),
    JSON.stringify(snapshot, null, 2),
    "utf-8",
  );
}

describe("workflow service", () => {
  afterEach(() => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }
    cleanupTrackedTempDirs();
  });

  test("resolveLatestWorkflowId returns the most recently updated workflow", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(
      home,
      sampleWorkflow("older", { updatedAt: "2026-03-24T12:00:00.000Z" }),
    );
    writeWorkflow(
      home,
      sampleWorkflow("newer", { updatedAt: "2026-03-24T12:05:00.000Z" }),
    );

    expect(resolveLatestWorkflowId()).toBe("newer");
  });

  test("resolveLatestWorkflowId ignores corrupt workflow files when valid snapshots remain", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(
      home,
      sampleWorkflow("valid-latest", { updatedAt: "2026-03-24T12:05:00.000Z" }),
    );
    writeFileSync(join(home, "workflows", "broken.json"), "{not valid json", "utf-8");

    expect(resolveLatestWorkflowId()).toBe("valid-latest");
  });

  test("getWorkflowStatus defaults to latest", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(
      home,
      sampleWorkflow("wf-1", { updatedAt: "2026-03-24T12:00:00.000Z" }),
    );
    writeWorkflow(
      home,
      sampleWorkflow("wf-2", {
        phase: "paused_declined",
        updatedAt: "2026-03-24T12:10:00.000Z",
        aspStatus: "declined",
      }),
    );

    const status = getWorkflowStatus();
    expect(status.workflowId).toBe("wf-2");
    expect(status.phase).toBe("paused_declined");
    expect(status.aspStatus).toBe("declined");
  });

  test("getWorkflowStatus accepts explicit latest", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(
      home,
      sampleWorkflow("wf-1", { updatedAt: "2026-03-24T12:00:00.000Z" }),
    );
    writeWorkflow(
      home,
      sampleWorkflow("wf-2", {
        phase: "awaiting_funding",
        updatedAt: "2026-03-24T12:10:00.000Z",
        walletMode: "new_wallet",
      }),
    );

    const status = getWorkflowStatus({ workflowId: "latest" });
    expect(status.workflowId).toBe("wf-2");
    expect(status.phase).toBe("awaiting_funding");
  });

  test("loadWorkflowSnapshot throws INPUT CLIError for corrupt files", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    writeFileSync(join(home, "workflows", "broken.json"), "{not valid json", "utf-8");

    try {
      loadWorkflowSnapshot("broken");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError);
      const cliError = error as CLIError;
      expect(cliError.category).toBe("INPUT");
      expect(cliError.message).toContain("Workflow file is corrupt or unreadable");
    }
  });

  test("resolveLatestWorkflowId throws INPUT CLIError when no workflows exist", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    try {
      resolveLatestWorkflowId();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError);
      const cliError = error as CLIError;
      expect(cliError.category).toBe("INPUT");
      expect(cliError.message).toContain("No saved workflows found");
    }
  });

  test("resolveLatestWorkflowId throws a targeted error when all workflow files are corrupt", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    writeFileSync(join(home, "workflows", "broken.json"), "{not valid json", "utf-8");

    try {
      resolveLatestWorkflowId();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError);
      const cliError = error as CLIError;
      expect(cliError.category).toBe("INPUT");
      expect(cliError.message).toContain("No readable saved workflows found");
    }
  });

  test("loadWorkflowSnapshot normalizes legacy workflows to configured wallet defaults", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(home, sampleWorkflow("legacy"));

    const snapshot = loadWorkflowSnapshot("legacy");
    expect(snapshot.walletMode).toBe("configured");
    expect(snapshot.walletAddress).toBeNull();
    expect(snapshot.requiredNativeFunding).toBeNull();
    expect(snapshot.requiredTokenFunding).toBeNull();
    expect(snapshot.backupConfirmed).toBe(false);
  });
});
