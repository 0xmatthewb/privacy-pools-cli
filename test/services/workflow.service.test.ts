import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";
import {
  alignSnapshotToPoolAccount,
  buildFlowLastError,
  buildFlowWarnings,
  buildWorkflowWalletBackup,
  classifyFlowMutation,
  cleanupTerminalWorkflowSecret,
  clearLastError,
  computeFlowWatchDelayMs,
  flowPrivacyDelayProfileSummary,
  humanPollDelayLabel,
  initialPollDelayMs,
  isDepositCheckpointFailure,
  isTerminalFlowPhase,
  loadWorkflowSecretRecord,
  getWorkflowStatus,
  loadWorkflowSnapshot,
  nextPollDelayMs,
  pickWorkflowPoolAccount,
  resolveFlowPrivacyDelayProfile,
  resolveLatestWorkflowId,
  resolveOptionalFlowPrivacyDelayProfile,
  sameWorkflowSnapshotState,
  saveWorkflowSnapshot,
  saveWorkflowSnapshotIfChanged,
  saveWorkflowSecretRecord,
  updateSnapshot,
  validateWorkflowWalletBackupPath,
  writePrivateTextFile,
  type FlowSnapshot,
} from "../../src/services/workflow.ts";
import {
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "../../src/services/workflow-storage-version.ts";
import { CLIError } from "../../src/utils/errors.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const VALID_WORKFLOW_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VALID_WORKFLOW_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

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
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
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

function samplePoolAccount(
  patch: Record<string, unknown> = {},
): {
  paNumber: number;
  paId: string;
  status: string;
  aspStatus: string;
  label: bigint;
  value: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
} {
  return {
    paNumber: 1,
    paId: "PA-1",
    status: "approved",
    aspStatus: "approved",
    label: 11n,
    value: 9_950_000n,
    blockNumber: 123n,
    txHash: `0x${"aa".repeat(32)}`,
    ...patch,
  } as {
    paNumber: number;
    paId: string;
    status: string;
    aspStatus: string;
    label: bigint;
    value: bigint;
    blockNumber: bigint;
    txHash: `0x${string}`;
  };
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

  test("resolveLatestWorkflowId ignores corrupt workflow files that are definitely older than the latest readable snapshot", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(
      home,
      sampleWorkflow("older-valid", { updatedAt: "2026-03-24T12:00:00.000Z" }),
    );
    writeWorkflow(
      home,
      sampleWorkflow("valid-latest", { updatedAt: "2026-03-24T12:05:00.000Z" }),
    );
    const brokenPath = join(home, "workflows", "broken.json");
    writeFileSync(brokenPath, "{not valid json", "utf-8");
    utimesSync(
      brokenPath,
      new Date("2026-03-24T11:59:00.000Z"),
      new Date("2026-03-24T11:59:00.000Z"),
    );

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
    expect(snapshot.schemaVersion).toBe(WORKFLOW_SNAPSHOT_VERSION);
    expect(snapshot.walletMode).toBe("configured");
    expect(snapshot.walletAddress).toBeNull();
    expect(snapshot.requiredNativeFunding).toBeNull();
    expect(snapshot.requiredTokenFunding).toBeNull();
    expect(snapshot.backupConfirmed).toBe(false);
  });

  test("loadWorkflowSnapshot accepts legacy workflow schema versions", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(
      home,
      sampleWorkflow("legacy-version", { schemaVersion: "1.5.0" }),
    );

    const snapshot = loadWorkflowSnapshot("legacy-version");
    expect(snapshot.schemaVersion).toBe(WORKFLOW_SNAPSHOT_VERSION);
  });

  test("loadWorkflowSnapshot rejects unsupported workflow schema versions", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeWorkflow(
      home,
      sampleWorkflow("future-version", { schemaVersion: "999" }),
    );

    expect(() => loadWorkflowSnapshot("future-version")).toThrow(
      "Workflow file uses an unsupported schema version: 999",
    );
  });

  test("pickWorkflowPoolAccount prefers label, then tx hash, then Pool Account number", () => {
    const byLabel = samplePoolAccount({
      paNumber: 2,
      paId: "PA-2",
      label: 77n,
      txHash: `0x${"bb".repeat(32)}`,
    });
    const byTxHash = samplePoolAccount({
      paNumber: 3,
      paId: "PA-3",
      label: 88n,
      txHash: `0x${"cc".repeat(32)}`,
    });
    const byNumber = samplePoolAccount({
      paNumber: 4,
      paId: "PA-4",
      label: 99n,
      txHash: `0x${"dd".repeat(32)}`,
    });

    expect(
      pickWorkflowPoolAccount(
        sampleWorkflow("wf-label", {
          depositLabel: "77",
          depositTxHash: byTxHash.txHash,
          poolAccountNumber: byNumber.paNumber,
        }),
        [byTxHash, byLabel, byNumber],
      )?.paId,
    ).toBe("PA-2");
    expect(
      pickWorkflowPoolAccount(
        sampleWorkflow("wf-tx", {
          depositLabel: "1000",
          depositTxHash: byTxHash.txHash.toUpperCase(),
          poolAccountNumber: byNumber.paNumber,
        }),
        [byTxHash, byNumber],
      )?.paId,
    ).toBe("PA-3");
    expect(
      pickWorkflowPoolAccount(
        sampleWorkflow("wf-number", {
          depositLabel: null,
          depositTxHash: null,
          poolAccountNumber: byNumber.paNumber,
        }),
        [byNumber],
      )?.paId,
    ).toBe("PA-4");
  });

  test("alignSnapshotToPoolAccount refreshes deposit metadata and clears stale errors", () => {
    const aligned = alignSnapshotToPoolAccount(
      sampleWorkflow("wf-align", {
        depositTxHash: null,
        depositBlockNumber: null,
        depositExplorerUrl: null,
        depositLabel: null,
        committedValue: null,
        lastError: {
          step: "inspect_approval",
          errorCode: "RPC_ERROR",
          errorMessage: "temporary",
          retryable: true,
          at: "2026-03-24T12:01:00.000Z",
        },
      }),
      11155111,
      samplePoolAccount({
        paNumber: 7,
        paId: "PA-7",
        label: 77n,
        value: 123_456n,
        blockNumber: 999n,
        txHash: `0x${"ef".repeat(32)}`,
      }),
    );

    expect(aligned.poolAccountId).toBe("PA-7");
    expect(aligned.depositLabel).toBe("77");
    expect(aligned.committedValue).toBe("123456");
    expect(aligned.depositBlockNumber).toBe("999");
    expect(aligned.depositExplorerUrl).toContain("0x");
    expect(aligned.lastError).toBeUndefined();
  });

  test("validateWorkflowWalletBackupPath accepts new files and rejects invalid targets", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const missingParent = join(home, "missing", "wallet.txt");
    expect(() => validateWorkflowWalletBackupPath("   ")).toThrow(
      "Workflow wallet backup path cannot be empty",
    );
    expect(() => validateWorkflowWalletBackupPath(missingParent)).toThrow(
      "Workflow wallet backup directory does not exist",
    );

    const validPath = join(home, "wallet.txt");
    expect(validateWorkflowWalletBackupPath(validPath)).toBe(validPath);

    const existingFile = join(home, "existing-wallet.txt");
    writeFileSync(existingFile, "secret", "utf-8");
    expect(() => validateWorkflowWalletBackupPath(existingFile)).toThrow(
      "Workflow wallet backup file already exists",
    );

    const targetDir = join(home, "wallet-dir");
    mkdirSync(targetDir);
    expect(() => validateWorkflowWalletBackupPath(targetDir)).toThrow(
      "Workflow wallet backup path must point to a file",
    );
  });

  test("writePrivateTextFile persists content and wraps filesystem failures", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const targetPath = join(home, "backup.txt");
    writePrivateTextFile(targetPath, "secret backup");
    expect(readFileSync(targetPath, "utf-8")).toBe("secret backup");
    expect(() =>
      writePrivateTextFile(join(home, "missing", "backup.txt"), "x"),
    ).toThrow("Could not write workflow wallet backup");
  });

  test("workflow secret records round-trip and render backup text", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const saved = saveWorkflowSecretRecord({
      schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
      workflowId: "wf-secret",
      chain: "sepolia",
      walletAddress: VALID_WORKFLOW_ADDRESS,
      privateKey: VALID_WORKFLOW_PRIVATE_KEY,
      exportedBackupPath: null,
      backupConfirmedAt: null,
      createdAt: "2026-03-24T12:00:00.000Z",
      updatedAt: "2026-03-24T12:00:00.000Z",
    });

    expect(loadWorkflowSecretRecord("wf-secret")).toEqual(saved);
    expect(buildWorkflowWalletBackup(saved)).toContain("Privacy Pools Flow Wallet");
    expect(buildWorkflowWalletBackup(saved)).toContain(saved.privateKey);
  });

  test("loadWorkflowSecretRecord rejects unreadable, unsupported, mismatched, and tampered secrets", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const secretsDir = join(home, "workflow-secrets");
    mkdirSync(secretsDir, { recursive: true });

    const unreadablePath = join(secretsDir, "wf-unreadable.json");
    writeFileSync(unreadablePath, "{bad json", "utf-8");
    expect(() => loadWorkflowSecretRecord("wf-unreadable")).toThrow(
      "Workflow wallet secret is unreadable",
    );

    const unsupportedPath = join(secretsDir, "wf-unsupported.json");
    writeFileSync(
      unsupportedPath,
      JSON.stringify({
        schemaVersion: "999",
        workflowId: "wf-unsupported",
        chain: "sepolia",
        walletAddress: VALID_WORKFLOW_ADDRESS,
        privateKey: VALID_WORKFLOW_PRIVATE_KEY,
      }),
      "utf-8",
    );
    expect(() => loadWorkflowSecretRecord("wf-unsupported")).toThrow(
      "unsupported schema version",
    );

    const mismatchedWorkflowPath = join(secretsDir, "wf-mismatch.json");
    writeFileSync(
      mismatchedWorkflowPath,
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-other",
        chain: "sepolia",
        walletAddress: VALID_WORKFLOW_ADDRESS,
        privateKey: VALID_WORKFLOW_PRIVATE_KEY,
      }),
      "utf-8",
    );
    expect(() => loadWorkflowSecretRecord("wf-mismatch")).toThrow(
      "does not match wf-mismatch",
    );

    const mismatchedAddressPath = join(secretsDir, "wf-address.json");
    writeFileSync(
      mismatchedAddressPath,
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-address",
        chain: "sepolia",
        walletAddress: "0x0000000000000000000000000000000000000001",
        privateKey: VALID_WORKFLOW_PRIVATE_KEY,
      }),
      "utf-8",
    );
    expect(() => loadWorkflowSecretRecord("wf-address")).toThrow(
      "address does not match",
    );
  });

  test("loadWorkflowSecretRecord rejects missing, structurally invalid, and broken private keys", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const secretsDir = join(home, "workflow-secrets");
    mkdirSync(secretsDir, { recursive: true });

    expect(() => loadWorkflowSecretRecord("wf-missing")).toThrow(
      "Workflow wallet secret is missing",
    );

    writeFileSync(
      join(secretsDir, "wf-structure.json"),
      JSON.stringify({ schemaVersion: WORKFLOW_SECRET_RECORD_VERSION }),
      "utf-8",
    );
    expect(() => loadWorkflowSecretRecord("wf-structure")).toThrow(
      "invalid structure",
    );

    writeFileSync(
      join(secretsDir, "wf-private-key.json"),
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-private-key",
        chain: "sepolia",
        walletAddress: VALID_WORKFLOW_ADDRESS,
        privateKey: "0x1234",
      }),
      "utf-8",
    );
    expect(() => loadWorkflowSecretRecord("wf-private-key")).toThrow(
      "invalid private key",
    );

    writeFileSync(
      join(secretsDir, "wf-unreadable-key.json"),
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-unreadable-key",
        chain: "sepolia",
        walletAddress: VALID_WORKFLOW_ADDRESS,
        privateKey: `0x${"f".repeat(64)}`,
      }),
      "utf-8",
    );
    expect(() => loadWorkflowSecretRecord("wf-unreadable-key")).toThrow(
      "contains an unreadable private key",
    );
  });

  test("saveWorkflowSnapshotIfChanged persists only changed workflow state", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const original = saveWorkflowSnapshot(sampleWorkflow("wf-save"));

    const sameState = saveWorkflowSnapshotIfChanged(original, {
      ...sampleWorkflow("wf-save"),
      updatedAt: "2026-03-24T12:30:00.000Z",
    });
    expect(sameWorkflowSnapshotState(original, sameState)).toBe(true);
    expect(sameState).toBe(original);

    const changed = saveWorkflowSnapshotIfChanged(original, {
      ...sampleWorkflow("wf-save"),
      phase: "paused_declined",
      aspStatus: "declined",
    });
    expect(changed).not.toBe(original);
    expect(loadWorkflowSnapshot("wf-save").phase).toBe("paused_declined");
  });

  test("cleanupTerminalWorkflowSecret removes saved secrets only for terminal new-wallet flows", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    saveWorkflowSecretRecord({
      schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
      workflowId: "wf-cleanup",
      chain: "sepolia",
      walletAddress: VALID_WORKFLOW_ADDRESS,
      privateKey: VALID_WORKFLOW_PRIVATE_KEY,
      exportedBackupPath: null,
      backupConfirmedAt: null,
      createdAt: "2026-03-24T12:00:00.000Z",
      updatedAt: "2026-03-24T12:00:00.000Z",
    });

    cleanupTerminalWorkflowSecret(
      sampleWorkflow("wf-cleanup", {
        walletMode: "new_wallet",
        phase: "awaiting_funding",
      }),
    );
    expect(loadWorkflowSecretRecord("wf-cleanup").workflowId).toBe("wf-cleanup");

    cleanupTerminalWorkflowSecret(
      sampleWorkflow("wf-cleanup", {
        walletMode: "new_wallet",
        phase: "completed",
      }),
    );
    expect(() => loadWorkflowSecretRecord("wf-cleanup")).toThrow(
      "Workflow wallet secret is missing",
    );
  });

  test("loadWorkflowSnapshot rejects missing workflows and invalid object structure", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    expect(() => loadWorkflowSnapshot("wf-missing")).toThrow("Unknown workflow");

    writeFileSync(
      join(home, "workflows", "wf-bad-structure.json"),
      JSON.stringify({ workflowId: "wf-bad-structure" }),
      "utf-8",
    );
    expect(() => loadWorkflowSnapshot("wf-bad-structure")).toThrow(
      "Workflow file has invalid structure",
    );
  });

  test("flow privacy helpers summarize profiles, parse overrides, and build warnings", () => {
    expect(flowPrivacyDelayProfileSummary("balanced")).toContain("15 to 90 minutes");
    expect(flowPrivacyDelayProfileSummary("aggressive")).toContain("2 to 12 hours");
    expect(flowPrivacyDelayProfileSummary("off", false)).toContain("legacy workflow");
    expect(resolveFlowPrivacyDelayProfile(undefined, "balanced")).toBe("balanced");
    expect(resolveOptionalFlowPrivacyDelayProfile(" aggressive ")).toBe(
      "aggressive",
    );
    expect(resolveOptionalFlowPrivacyDelayProfile("   ")).toBeUndefined();
    expect(() => resolveFlowPrivacyDelayProfile("mystery", "balanced")).toThrow(
      "Unknown flow privacy delay profile",
    );

    const warnings = buildFlowWarnings(
      sampleWorkflow("wf-warning", {
        phase: "awaiting_asp",
        asset: "USDC",
        assetDecimals: 6,
        committedValue: null,
        estimatedCommittedValue: "100198475",
        privacyDelayProfile: "off",
        privacyDelayConfigured: true,
      }),
    );
    expect(warnings.map((warning) => warning.code)).toEqual([
      "timing_delay_disabled",
      "amount_pattern_linkability",
    ]);
    expect(warnings[1]?.message).toContain("Estimated committed value");

    expect(
      buildFlowWarnings(
        sampleWorkflow("wf-terminal", {
          phase: "completed",
          assetDecimals: 6,
          committedValue: "100198475",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
        }),
      ),
    ).toEqual([]);
  });

  test("computeFlowWatchDelayMs handles fallback, active waits, and elapsed delays", () => {
    expect(
      computeFlowWatchDelayMs(
        sampleWorkflow("wf-fallback", { phase: "awaiting_asp" }),
        45_000,
        1_000,
      ),
    ).toBe(45_000);
    expect(
      computeFlowWatchDelayMs(
        sampleWorkflow("wf-invalid-delay", {
          phase: "approved_waiting_privacy_delay",
          privacyDelayUntil: "not-a-date",
        }),
        45_000,
        1_000,
      ),
    ).toBe(45_000);
    expect(
      computeFlowWatchDelayMs(
        sampleWorkflow("wf-active-delay", {
          phase: "approved_waiting_privacy_delay",
          privacyDelayUntil: "2026-03-24T12:00:10.000Z",
        }),
        45_000,
        Date.parse("2026-03-24T12:00:05.000Z"),
      ),
    ).toBe(5_000);
    expect(
      computeFlowWatchDelayMs(
        sampleWorkflow("wf-elapsed-delay", {
          phase: "approved_waiting_privacy_delay",
          privacyDelayUntil: "2026-03-24T12:00:10.000Z",
        }),
        45_000,
        Date.parse("2026-03-24T12:00:11.000Z"),
      ),
    ).toBe(0);
  });

  test("snapshot helper utilities keep timestamps, polling, and retry classification aligned", () => {
    const withError = sampleWorkflow("wf-last-error", {
      lastError: {
        step: "deposit",
        errorCode: "WORKFLOW_DEPOSIT_CHECKPOINT_FAILED",
        errorMessage: "deposit succeeded but could not checkpoint it locally",
        retryable: false,
        at: "2026-03-24T12:01:00.000Z",
      },
    });

    const patched = updateSnapshot(withError, {
      phase: "awaiting_funding",
    });
    expect(patched.phase).toBe("awaiting_funding");
    expect(patched.updatedAt).not.toBe(withError.updatedAt);
    expect(clearLastError(withError).lastError).toBeUndefined();
    expect(isDepositCheckpointFailure(withError.lastError)).toBe(true);
    expect(isDepositCheckpointFailure(undefined)).toBe(false);
    expect(initialPollDelayMs("awaiting_funding")).toBeLessThan(
      initialPollDelayMs("awaiting_asp"),
    );
    expect(nextPollDelayMs(30_000, "awaiting_funding")).toBe(60_000);
    expect(nextPollDelayMs(30_000, "awaiting_asp")).toBe(60_000);
    expect(humanPollDelayLabel(120_000)).toBe("2 minutes");
    expect(humanPollDelayLabel(45_000)).toBe("45 seconds");
    expect(isTerminalFlowPhase("completed")).toBe(true);
    expect(isTerminalFlowPhase("awaiting_asp")).toBe(false);
  });

  test("buildFlowLastError keeps classified retryable metadata", () => {
    const lastError = buildFlowLastError(
      "inspect_approval",
      new CLIError("rpc temporarily unavailable", "RPC", undefined, undefined, true),
    );

    expect(lastError.step).toBe("inspect_approval");
    expect(lastError.errorCode).toBe("RPC_ERROR");
    expect(lastError.retryable).toBe(true);
  });

  test("classifyFlowMutation stops workflows only when Pool Account state drifted externally", () => {
    const matchingAccount = samplePoolAccount({
      value: 9_950_000n,
      label: 11n,
    });
    const matchingSnapshot = sampleWorkflow("wf-match", {
      committedValue: "9950000",
      depositLabel: "11",
    });

    expect(classifyFlowMutation(matchingSnapshot, matchingAccount)).toBeNull();
    expect(classifyFlowMutation(matchingSnapshot, undefined)).toBe(
      "stopped_external",
    );
    expect(
      classifyFlowMutation(
        matchingSnapshot,
        samplePoolAccount({ status: "spent", aspStatus: "approved" }),
      ),
    ).toBe("stopped_external");
    expect(
      classifyFlowMutation(
        matchingSnapshot,
        samplePoolAccount({ status: "exited", aspStatus: "declined" }),
      ),
    ).toBe("stopped_external");
    expect(
      classifyFlowMutation(
        matchingSnapshot,
        samplePoolAccount({ value: 1n, label: 11n }),
      ),
    ).toBe("stopped_external");
    expect(
      classifyFlowMutation(
        matchingSnapshot,
        samplePoolAccount({ value: 9_950_000n, label: 12n }),
      ),
    ).toBe("stopped_external");
  });
});
