import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  attachDepositResultToSnapshot,
  attachPendingDepositToSnapshot,
  attachPendingRagequitToSnapshot,
  attachPendingWithdrawalToSnapshot,
  attachRagequitResultToSnapshot,
  attachWithdrawalResultToSnapshot,
  alignSnapshotToPoolAccount,
  buildFlowWarnings,
  buildFlowLastError,
  buildSavedWorkflowRecoveryCommand,
  buildWorkflowWalletBackup,
  classifyFlowMutation,
  clearLastError,
  computeFlowWatchDelayMs,
  cleanupTerminalWorkflowSecret,
  createInitialSnapshot,
  deleteWorkflowSnapshotFile,
  deleteWorkflowSecretRecord,
  flowPrivacyDelayProfileSummary,
  getFlowSignerAddress,
  getFlowSignerPrivateKey,
  humanPollDelayLabel,
  initialPollDelayMs,
  isDepositCheckpointFailure,
  isTerminalFlowPhase,
  listSavedWorkflowIds,
  loadWorkflowSecretRecord,
  loadWorkflowSnapshot,
  normalizeWorkflowSnapshot,
  nextPollDelayMs,
  overrideWorkflowTimingForTests,
  pickWorkflowPoolAccount,
  resolveFlowPrivacyDelayProfile,
  resolveOptionalFlowPrivacyDelayProfile,
  resolveLatestWorkflowId,
  sampleFlowPrivacyDelayMs,
  sameWorkflowSnapshotState,
  saveWorkflowSecretRecord,
  saveWorkflowSnapshot,
  saveWorkflowSnapshotIfChanged,
  updateSnapshot,
  validateWorkflowWalletBackupPath,
  writePrivateTextFile,
  type FlowLastError,
  type FlowSnapshot,
} from "../../src/services/workflow.ts";
import {
  LEGACY_WORKFLOW_SNAPSHOT_VERSIONS,
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "../../src/services/workflow-storage-version.ts";
import {
  ensureConfigDir,
  getWorkflowSecretsDir,
  saveSignerKey,
} from "../../src/services/config.ts";
import type { PoolAccountRef } from "../../src/utils/pool-accounts.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { cleanupTrackedTempDirs, createTrackedTempDir } from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const CONFIGURED_SIGNER =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const WORKFLOW_SIGNER =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-workflow-helper-");
  process.env.PRIVACY_POOLS_HOME = home;
  ensureConfigDir();
  return home;
}

function sampleWorkflow(
  workflowId = "wf-helper",
  patch: Partial<FlowSnapshot> = {},
): FlowSnapshot {
  const now = "2026-03-24T12:00:00.000Z";
  return {
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowId,
    createdAt: now,
    updatedAt: now,
    phase: "awaiting_asp",
    chain: "mainnet",
    asset: "ETH",
    depositAmount: "100000000000000000",
    recipient: "0x4444444444444444444444444444444444444444",
    walletMode: "configured",
    walletAddress: null,
    requiredNativeFunding: null,
    requiredTokenFunding: null,
    backupConfirmed: false,
    ...patch,
  };
}

function samplePoolAccount(
  patch: Partial<PoolAccountRef> = {},
): PoolAccountRef {
  return {
    paNumber: 1,
    paId: "PA-1",
    status: "approved",
    aspStatus: "approved",
    commitment: {
      hash: 77n,
      label: 88n,
      value: 900n,
      blockNumber: 123n,
      txHash: "0x" + "aa".repeat(32),
    },
    label: 88n,
    value: 900n,
    blockNumber: 123n,
    txHash: "0x" + "aa".repeat(32),
    ...patch,
  };
}

describe("workflow helper coverage", () => {
  afterEach(() => {
    mock.restore();
    overrideWorkflowTimingForTests();
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }
    cleanupTrackedTempDirs();
  });

  test("validateWorkflowWalletBackupPath accepts a fresh file path", () => {
    const home = useIsolatedHome();
    const backupDir = join(home, "exports");
    mkdirSync(backupDir, { recursive: true });

    expect(
      validateWorkflowWalletBackupPath(` ${join(backupDir, "flow-wallet.txt")} `),
    ).toBe(join(backupDir, "flow-wallet.txt"));
  });

  test("validateWorkflowWalletBackupPath rejects empty paths", () => {
    expect(() => validateWorkflowWalletBackupPath("   ")).toThrow(
      "Workflow wallet backup path cannot be empty.",
    );
  });

  test("validateWorkflowWalletBackupPath rejects missing parent directories", () => {
    const home = useIsolatedHome();

    expect(() =>
      validateWorkflowWalletBackupPath(
        join(home, "missing-parent", "flow-wallet.txt"),
      ),
    ).toThrow("Workflow wallet backup directory does not exist");
  });

  test("validateWorkflowWalletBackupPath rejects parents that are files", () => {
    const home = useIsolatedHome();
    const parentFile = join(home, "not-a-dir");
    writeFileSync(parentFile, "oops", "utf-8");

    expect(() =>
      validateWorkflowWalletBackupPath(join(parentFile, "flow-wallet.txt")),
    ).toThrow("Workflow wallet backup parent is not a directory");
  });

  test("validateWorkflowWalletBackupPath rejects directory targets", () => {
    const home = useIsolatedHome();
    const backupDir = join(home, "exports");
    const targetDir = join(backupDir, "already-a-dir");
    mkdirSync(targetDir, { recursive: true });

    expect(() => validateWorkflowWalletBackupPath(targetDir)).toThrow(
      "Workflow wallet backup path must point to a file",
    );
  });

  test("validateWorkflowWalletBackupPath rejects existing files", () => {
    const home = useIsolatedHome();
    const backupDir = join(home, "exports");
    mkdirSync(backupDir, { recursive: true });
    const targetFile = join(backupDir, "existing.txt");
    writeFileSync(targetFile, "present", "utf-8");

    expect(() => validateWorkflowWalletBackupPath(targetFile)).toThrow(
      "Workflow wallet backup file already exists",
    );
  });

  test("writePrivateTextFile writes private backups and rewraps write failures", () => {
    const home = useIsolatedHome();
    const backupDir = join(home, "exports");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, "wallet.txt");

    writePrivateTextFile(backupPath, "secret");
    expect(readFileSync(backupPath, "utf-8")).toBe("secret");

    expect(() =>
      writePrivateTextFile(join(home, "missing", "wallet.txt"), "secret"),
    ).toThrow("Could not write workflow wallet backup");
  });

  test("writePrivateTextFile ignores legacy predictable temp-file symlinks", () => {
    const home = useIsolatedHome();
    const backupDir = join(home, "exports");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, "wallet.txt");
    const victimPath = join(home, "victim.txt");
    writeFileSync(victimPath, "do not overwrite", "utf-8");
    symlinkSync(victimPath, `${backupPath}.tmp`);

    writePrivateTextFile(backupPath, "secret");

    expect(readFileSync(backupPath, "utf-8")).toBe("secret");
    expect(readFileSync(victimPath, "utf-8")).toBe("do not overwrite");
  });

  test("loadWorkflowSecretRecord surfaces missing, unreadable, and malformed files", () => {
    useIsolatedHome();

    expect(() => loadWorkflowSecretRecord("missing")).toThrow(
      "Workflow wallet secret is missing",
    );

    writeFileSync(join(getWorkflowSecretsDir(), "broken.json"), "{", "utf-8");
    expect(() => loadWorkflowSecretRecord("broken")).toThrow(
      "Workflow wallet secret is unreadable",
    );

    writeFileSync(
      join(getWorkflowSecretsDir(), "malformed.json"),
      JSON.stringify({ workflowId: "malformed", walletAddress: "0x1234" }),
      "utf-8",
    );
    expect(() => loadWorkflowSecretRecord("malformed")).toThrow(
      "Workflow wallet secret has invalid structure",
    );
  });

  test("loadWorkflowSecretRecord rejects unsupported secret schema versions", () => {
    useIsolatedHome();

    writeFileSync(
      join(getWorkflowSecretsDir(), "future-secret.json"),
      JSON.stringify({
        schemaVersion: "999",
        workflowId: "future-secret",
        chain: "mainnet",
        walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
        privateKey: WORKFLOW_SIGNER,
      }),
      "utf-8",
    );

    expect(() => loadWorkflowSecretRecord("future-secret")).toThrow(
      "Workflow wallet secret uses an unsupported schema version: 999",
    );
  });

  test("loadWorkflowSecretRecord rejects tampered workflow ids", () => {
    useIsolatedHome();

    writeFileSync(
      join(getWorkflowSecretsDir(), "wf-secret.json"),
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-other",
        chain: "mainnet",
        walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
        privateKey: WORKFLOW_SIGNER,
      }),
      "utf-8",
    );

    expect(() => loadWorkflowSecretRecord("wf-secret")).toThrow(
      "does not match wf-secret",
    );
  });

  test("loadWorkflowSecretRecord rejects invalid private keys", () => {
    useIsolatedHome();

    writeFileSync(
      join(getWorkflowSecretsDir(), "wf-secret.json"),
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-secret",
        chain: "mainnet",
        walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
        privateKey: "0x1234",
      }),
      "utf-8",
    );

    expect(() => loadWorkflowSecretRecord("wf-secret")).toThrow(
      "contains an invalid private key",
    );
  });

  test("loadWorkflowSecretRecord rejects unreadable private keys that pass the hex format check", () => {
    useIsolatedHome();

    writeFileSync(
      join(getWorkflowSecretsDir(), "wf-secret.json"),
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-secret",
        chain: "mainnet",
        walletAddress: "0x3333333333333333333333333333333333333333",
        privateKey: "0x" + "00".repeat(32),
      }),
      "utf-8",
    );

    expect(() => loadWorkflowSecretRecord("wf-secret")).toThrow(
      "contains an unreadable private key",
    );
  });

  test("loadWorkflowSecretRecord rejects wallet address mismatches", () => {
    useIsolatedHome();

    writeFileSync(
      join(getWorkflowSecretsDir(), "wf-secret.json"),
      JSON.stringify({
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId: "wf-secret",
        chain: "mainnet",
        walletAddress: privateKeyToAccount(CONFIGURED_SIGNER).address,
        privateKey: WORKFLOW_SIGNER,
      }),
      "utf-8",
    );

    expect(() => loadWorkflowSecretRecord("wf-secret")).toThrow(
      "address does not match the stored workflow wallet",
    );
  });

  test("loadWorkflowSecretRecord and getFlowSignerAddress use the workflow secret for new-wallet flows", () => {
    useIsolatedHome();

    writeFileSync(
      join(getWorkflowSecretsDir(), "wf-secret.json"),
      JSON.stringify({
        schemaVersion: "1.5.0",
        workflowId: "wf-secret",
        chain: "mainnet",
        walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
        privateKey: WORKFLOW_SIGNER,
      }),
      "utf-8",
    );

    const record = loadWorkflowSecretRecord("wf-secret");
    expect(record.privateKey).toBe(WORKFLOW_SIGNER);
    expect(record.walletAddress).toBe(privateKeyToAccount(WORKFLOW_SIGNER).address);

    expect(
      getFlowSignerAddress(
        sampleWorkflow("wf-secret", {
          walletMode: "new_wallet",
          walletAddress: record.walletAddress,
          backupConfirmed: true,
        }),
      ),
    ).toBe(record.walletAddress);
  });

  test("buildWorkflowWalletBackup renders a reusable human backup", () => {
    const backup = buildWorkflowWalletBackup({
      workflowId: "wf-1",
      chain: "mainnet",
      walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
      privateKey: WORKFLOW_SIGNER,
    });

    expect(backup).toContain("Privacy Pools Flow Wallet");
    expect(backup).toContain("Workflow ID: wf-1");
    expect(backup).toContain("Chain: mainnet");
    expect(backup).toContain(`Wallet Address: ${privateKeyToAccount(WORKFLOW_SIGNER).address}`);
    expect(backup).toContain(`Private Key: ${WORKFLOW_SIGNER}`);
  });

  test("getFlowSignerAddress uses the configured signer for configured workflows", () => {
    useIsolatedHome();
    saveSignerKey(CONFIGURED_SIGNER);

    expect(getFlowSignerAddress(sampleWorkflow())).toBe(
      privateKeyToAccount(CONFIGURED_SIGNER).address,
    );
  });

  test("pickWorkflowPoolAccount prefers deposit label, then tx hash, then pool account number", () => {
    const labelMatch = samplePoolAccount({
      paNumber: 2,
      paId: "PA-2",
      label: 99n,
      commitment: {
        hash: 2n,
        label: 99n,
        value: 900n,
        blockNumber: 124n,
        txHash: "0x" + "bb".repeat(32),
      },
      txHash: "0x" + "bb".repeat(32),
    });
    const txMatch = samplePoolAccount({
      paNumber: 3,
      paId: "PA-3",
      txHash: "0x" + "cc".repeat(32),
      commitment: {
        hash: 3n,
        label: 100n,
        value: 900n,
        blockNumber: 125n,
        txHash: "0x" + "cc".repeat(32),
      },
      label: 100n,
    });
    const numberMatch = samplePoolAccount({
      paNumber: 4,
      paId: "PA-4",
    });

    expect(
      pickWorkflowPoolAccount(
        sampleWorkflow("wf-label", { depositLabel: "99" }),
        [numberMatch, txMatch, labelMatch],
      )?.paId,
    ).toBe("PA-2");
    expect(
      pickWorkflowPoolAccount(
        sampleWorkflow("wf-tx", {
          depositLabel: null,
          depositTxHash: "0x" + "cc".repeat(32),
        }),
        [numberMatch, txMatch],
      )?.paId,
    ).toBe("PA-3");
    expect(
      pickWorkflowPoolAccount(
        sampleWorkflow("wf-number", {
          depositLabel: null,
          depositTxHash: null,
          poolAccountNumber: 4,
        }),
        [numberMatch],
      )?.paId,
    ).toBe("PA-4");
  });

  test("alignSnapshotToPoolAccount refreshes the saved pool account details and clears lastError", () => {
    const aligned = alignSnapshotToPoolAccount(
      sampleWorkflow("wf-align", {
        lastError: {
          step: "withdraw",
          errorCode: "RPC_ERROR",
          errorMessage: "pending",
          retryable: true,
          at: "2026-03-24T12:01:00.000Z",
        },
      }),
      1,
      samplePoolAccount({
        paNumber: 7,
        paId: "PA-7",
        label: 123n,
        value: 777n,
        blockNumber: 456n,
        txHash: "0x" + "dd".repeat(32),
        commitment: {
          hash: 7n,
          label: 123n,
          value: 777n,
          blockNumber: 456n,
          txHash: "0x" + "dd".repeat(32),
        },
      }),
    );

    expect(aligned.lastError).toBeUndefined();
    expect(aligned.poolAccountNumber).toBe(7);
    expect(aligned.poolAccountId).toBe("PA-7");
    expect(aligned.depositLabel).toBe("123");
    expect(aligned.committedValue).toBe("777");
    expect(aligned.depositExplorerUrl).toContain("0x" + "dd".repeat(32));
  });

  test("createInitialSnapshot applies workflow defaults and funding metadata", () => {
    const snapshot = createInitialSnapshot({
      workflowId: "wf-initial",
      walletMode: "new_wallet",
      walletAddress: "0x1234567890123456789012345678901234567890",
      assetDecimals: 6,
      requiredNativeFunding: 123n,
      requiredTokenFunding: 456n,
      backupConfirmed: true,
      phase: "awaiting_funding",
      chain: "optimism",
      asset: "USDC",
      depositAmount: 1_000_000n,
      recipient: "0x4444444444444444444444444444444444444444",
    });

    expect(snapshot.workflowId).toBe("wf-initial");
    expect(snapshot.phase).toBe("awaiting_funding");
    expect(snapshot.walletMode).toBe("new_wallet");
    expect(snapshot.walletAddress).toBe(
      "0x1234567890123456789012345678901234567890",
    );
    expect(snapshot.assetDecimals).toBe(6);
    expect(snapshot.requiredNativeFunding).toBe("123");
    expect(snapshot.requiredTokenFunding).toBe("456");
    expect(snapshot.backupConfirmed).toBe(true);
    expect(snapshot.privacyDelayProfile).toBe("balanced");
    expect(snapshot.privacyDelayConfigured).toBe(true);
    expect(snapshot.depositAmount).toBe("1000000");
    expect(snapshot.aspStatus).toBeUndefined();
  });

  test("attach snapshot helpers move workflows through deposit, withdraw, and ragequit states", () => {
    const baseSnapshot = sampleWorkflow("wf-attach", {
      phase: "awaiting_funding",
      lastError: {
        step: "deposit",
        errorCode: "RPC_ERROR",
        errorMessage: "retry me",
        retryable: true,
        at: "2026-03-24T12:01:00.000Z",
      },
    });

    const pendingDeposit = attachPendingDepositToSnapshot(baseSnapshot, {
      depositTxHash: "0x" + "11".repeat(32),
      depositExplorerUrl: "https://example.invalid/deposit",
    });
    expect(pendingDeposit.phase).toBe("depositing_publicly");
    expect(pendingDeposit.depositTxHash).toBe("0x" + "11".repeat(32));
    expect(pendingDeposit.depositExplorerUrl).toBe(
      "https://example.invalid/deposit",
    );
    expect(pendingDeposit.lastError).toBeUndefined();

    const deposited = attachDepositResultToSnapshot(pendingDeposit, {
      chain: "mainnet",
      asset: "ETH",
      amount: 100n,
      decimals: 18,
      poolAccountNumber: 4,
      poolAccountId: "PA-4",
      depositTxHash: "0x" + "22".repeat(32),
      depositBlockNumber: 456n,
      depositExplorerUrl: "https://example.invalid/deposit/confirmed",
      depositLabel: 123n,
      committedValue: 99n,
    });
    expect(deposited.phase).toBe("awaiting_asp");
    expect(deposited.poolAccountNumber).toBe(4);
    expect(deposited.poolAccountId).toBe("PA-4");
    expect(deposited.depositLabel).toBe("123");
    expect(deposited.committedValue).toBe("99");
    expect(deposited.aspStatus).toBe("pending");

    const pendingWithdraw = attachPendingWithdrawalToSnapshot(
      deposited,
      1,
      ("0x" + "33".repeat(32)) as `0x${string}`,
    );
    expect(pendingWithdraw.phase).toBe("withdrawing");
    expect(pendingWithdraw.withdrawTxHash).toBe("0x" + "33".repeat(32));
    expect(pendingWithdraw.withdrawBlockNumber).toBeNull();
    expect(pendingWithdraw.withdrawExplorerUrl).toContain(
      "0x" + "33".repeat(32),
    );

    const withdrawn = attachWithdrawalResultToSnapshot(pendingWithdraw, {
      chainId: 1,
      withdrawTxHash: "0x" + "44".repeat(32),
      withdrawBlockNumber: 789n,
    });
    expect(withdrawn.phase).toBe("completed");
    expect(withdrawn.aspStatus).toBe("approved");
    expect(withdrawn.withdrawTxHash).toBe("0x" + "44".repeat(32));
    expect(withdrawn.withdrawBlockNumber).toBe("789");
    expect(withdrawn.withdrawExplorerUrl).toContain("0x" + "44".repeat(32));

    const pendingRagequit = attachPendingRagequitToSnapshot(
      deposited,
      10,
      ("0x" + "55".repeat(32)) as `0x${string}`,
    );
    expect(pendingRagequit.ragequitTxHash).toBe("0x" + "55".repeat(32));
    expect(pendingRagequit.ragequitBlockNumber).toBeNull();
    expect(pendingRagequit.ragequitExplorerUrl).toContain(
      "0x" + "55".repeat(32),
    );

    const ragequitCompleted = attachRagequitResultToSnapshot(
      pendingRagequit,
      {
        chainId: 10,
        aspStatus: "declined",
        ragequitTxHash: "0x" + "66".repeat(32),
        ragequitBlockNumber: "321",
      },
    );
    expect(ragequitCompleted.phase).toBe("completed_public_recovery");
    expect(ragequitCompleted.aspStatus).toBe("declined");
    expect(ragequitCompleted.ragequitTxHash).toBe("0x" + "66".repeat(32));
    expect(ragequitCompleted.ragequitBlockNumber).toBe("321");
    expect(ragequitCompleted.ragequitExplorerUrl).toContain(
      "0x" + "66".repeat(32),
    );
  });

  test("buildSavedWorkflowRecoveryCommand targets the saved workflow id", () => {
    expect(buildSavedWorkflowRecoveryCommand(sampleWorkflow("wf-ragequit"))).toBe(
      "privacy-pools flow ragequit wf-ragequit",
    );
  });

  test("updateSnapshot and clearLastError refresh snapshot timestamps predictably", async () => {
    const snapshot = sampleWorkflow("wf-clear", {
      lastError: {
        step: "deposit",
        errorCode: "RPC_ERROR",
        errorMessage: "deposit failed",
        retryable: true,
        at: "2026-03-24T12:01:00.000Z",
      },
    });

    const updated = updateSnapshot(snapshot, { phase: "awaiting_funding" });
    expect(updated.phase).toBe("awaiting_funding");
    expect(updated.updatedAt).not.toBe(snapshot.updatedAt);

    await new Promise((resolve) => setTimeout(resolve, 2));
    const cleared = clearLastError(updated);
    expect(cleared.lastError).toBeUndefined();
    expect(cleared.updatedAt).not.toBe(updated.updatedAt);

    const untouched = sampleWorkflow("wf-clean");
    expect(clearLastError(untouched)).toBe(untouched);
  });

  test("normalizeWorkflowSnapshot fills optional fields and snapshot comparisons ignore updatedAt", () => {
    const normalized = normalizeWorkflowSnapshot(sampleWorkflow("wf-normalize"));
    expect(normalized.walletMode).toBe("configured");
    expect(normalized.walletAddress).toBeNull();
    expect(normalized.requiredNativeFunding).toBeNull();
    expect(normalized.requiredTokenFunding).toBeNull();
    expect(normalized.privacyDelayProfile).toBe("off");
    expect(normalized.privacyDelayConfigured).toBe(false);
    expect(normalized.approvalObservedAt).toBeNull();
    expect(normalized.privacyDelayUntil).toBeNull();
    expect(normalized.poolAccountId).toBeNull();

    const baseline = normalizeWorkflowSnapshot(
      sampleWorkflow("wf-compare", { updatedAt: "2026-03-24T12:00:00.000Z" }),
    );
    const later = {
      ...baseline,
      updatedAt: "2026-03-24T12:10:00.000Z",
    };
    expect(sameWorkflowSnapshotState(baseline, later)).toBe(true);
    expect(
      sameWorkflowSnapshotState(baseline, {
        ...later,
        committedValue: "123",
      }),
    ).toBe(false);
  });

  test("flow privacy delay helpers parse profiles, honor overrides, and cap watch delay", () => {
    expect(resolveFlowPrivacyDelayProfile(undefined, "balanced")).toBe("balanced");
    expect(resolveOptionalFlowPrivacyDelayProfile(undefined)).toBeUndefined();
    expect(resolveOptionalFlowPrivacyDelayProfile(" aggressive ")).toBe(
      "aggressive",
    );
    expect(() => resolveFlowPrivacyDelayProfile("slow", "balanced")).toThrow(
      "Unknown flow privacy delay profile",
    );

    overrideWorkflowTimingForTests({
      samplePrivacyDelayMs: (profile) => (profile === "balanced" ? 42_000 : 84_000),
    });
    expect(sampleFlowPrivacyDelayMs("balanced")).toBe(42_000);
    expect(sampleFlowPrivacyDelayMs("aggressive")).toBe(84_000);

    const delaySnapshot = normalizeWorkflowSnapshot(
      sampleWorkflow("wf-delay", {
        phase: "approved_waiting_privacy_delay",
        privacyDelayUntil: "2026-03-24T12:45:00.000Z",
      }),
    );
    expect(
      computeFlowWatchDelayMs(
        delaySnapshot,
        60_000,
        Date.parse("2026-03-24T12:00:00.000Z"),
      ),
    ).toBe(300_000);
    expect(
      computeFlowWatchDelayMs(
        delaySnapshot,
        60_000,
        Date.parse("2026-03-24T12:44:30.000Z"),
      ),
    ).toBe(30_000);
  });

  test("sampleFlowPrivacyDelayMs uses the default balanced and aggressive windows", () => {
    const originalRandom = Math.random;

    try {
      overrideWorkflowTimingForTests();

      Math.random = () => 0;
      expect(sampleFlowPrivacyDelayMs("balanced")).toBe(15 * 60_000);

      Math.random = () => 0.999999999999;
      expect(sampleFlowPrivacyDelayMs("aggressive")).toBe(12 * 60 * 60_000);
    } finally {
      Math.random = originalRandom;
    }
  });

  test("flow privacy delay summaries and watch-delay fallbacks stay human-readable", () => {
    expect(flowPrivacyDelayProfileSummary("balanced")).toBe(
      "Balanced (randomized 15 to 90 minutes)",
    );
    expect(flowPrivacyDelayProfileSummary("aggressive")).toBe(
      "Aggressive (randomized 2 to 12 hours)",
    );
    expect(flowPrivacyDelayProfileSummary("off")).toBe("Off (no added hold)");
    expect(flowPrivacyDelayProfileSummary("off", false)).toContain(
      "legacy workflow",
    );

    expect(
      computeFlowWatchDelayMs(
        normalizeWorkflowSnapshot(
          sampleWorkflow("wf-no-delay", {
            phase: "awaiting_asp",
            privacyDelayUntil: "not-a-date",
          }),
        ),
        45_000,
        Date.parse("2026-03-24T12:00:00.000Z"),
      ),
    ).toBe(45_000);
    expect(
      computeFlowWatchDelayMs(
        normalizeWorkflowSnapshot(
          sampleWorkflow("wf-invalid-delay", {
            phase: "approved_waiting_privacy_delay",
            privacyDelayUntil: "not-a-date",
          }),
        ),
        45_000,
        Date.parse("2026-03-24T12:00:00.000Z"),
      ),
    ).toBe(45_000);
  });

  test("buildFlowWarnings surfaces explicit off-delay and full-balance amount warnings", () => {
    const warnings = buildFlowWarnings(
      normalizeWorkflowSnapshot(
        sampleWorkflow("wf-warnings", {
          asset: "USDC",
          assetDecimals: 6,
          committedValue: "100198474",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
        }),
      ),
    );

    expect(warnings).toEqual([
      expect.objectContaining({
        code: "timing_delay_disabled",
        category: "privacy",
      }),
      expect.objectContaining({
        code: "amount_pattern_linkability",
        category: "privacy",
      }),
    ]);
  });

  test("buildFlowWarnings labels estimated net deposited amounts before funding", () => {
    const warnings = buildFlowWarnings(
      normalizeWorkflowSnapshot(
        sampleWorkflow("wf-estimate", {
          phase: "awaiting_funding",
          asset: "USDC",
          assetDecimals: 6,
          committedValue: null,
          estimatedCommittedValue: "100198474",
          privacyDelayProfile: "balanced",
          privacyDelayConfigured: true,
        }),
      ),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("Estimated net deposited amount");
  });

  test("buildFlowWarnings ignores malformed committed values safely", () => {
    expect(
      buildFlowWarnings(
        normalizeWorkflowSnapshot(
          sampleWorkflow("wf-malformed-warning", {
            asset: "USDC",
            assetDecimals: 6,
            committedValue: "not-a-bigint",
            privacyDelayProfile: "balanced",
            privacyDelayConfigured: true,
          }),
        ),
      ),
    ).toEqual([]);
  });

  test("buildFlowWarnings stays quiet for round amounts and terminal snapshots", () => {
    expect(
      buildFlowWarnings(
        normalizeWorkflowSnapshot(
          sampleWorkflow("wf-round", {
            asset: "USDC",
            assetDecimals: 6,
            committedValue: "100000000",
            privacyDelayProfile: "balanced",
            privacyDelayConfigured: true,
          }),
        ),
      ),
    ).toEqual([]);

    expect(
      buildFlowWarnings(
        normalizeWorkflowSnapshot(
          sampleWorkflow("wf-terminal-warning", {
            phase: "completed",
            asset: "USDC",
            assetDecimals: 6,
            committedValue: "100198474",
            privacyDelayProfile: "off",
            privacyDelayConfigured: true,
          }),
        ),
      ),
    ).toEqual([]);
  });

  test("saveWorkflowSnapshot helpers persist, reuse, and clean up workflow files", () => {
    useIsolatedHome();

    const snapshot = normalizeWorkflowSnapshot(
      sampleWorkflow("wf-persist", { walletMode: "new_wallet" }),
    );
    const saved = saveWorkflowSnapshot(snapshot);
    expect(saved.workflowId).toBe("wf-persist");
    expect(
      readFileSync(join(process.env.PRIVACY_POOLS_HOME!, "workflows", "wf-persist.json"), "utf-8"),
    ).toContain("\"workflowId\": \"wf-persist\"");

    const unchanged = saveWorkflowSnapshotIfChanged(saved, {
      ...saved,
      updatedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(unchanged).toBe(saved);

    const secret = saveWorkflowSecretRecord({
      schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
      workflowId: "wf-persist",
      chain: "mainnet",
      walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
      privateKey: WORKFLOW_SIGNER,
    });
    expect(secret.walletAddress).toBe(privateKeyToAccount(WORKFLOW_SIGNER).address);
    expect(loadWorkflowSecretRecord("wf-persist").privateKey).toBe(WORKFLOW_SIGNER);

    deleteWorkflowSecretRecord("wf-persist");
    expect(() => loadWorkflowSecretRecord("wf-persist")).toThrow(
      "Workflow wallet secret is missing",
    );

    deleteWorkflowSecretRecord("wf-persist");
    deleteWorkflowSnapshotFile("wf-persist");
    expect(
      () =>
        readFileSync(
          join(process.env.PRIVACY_POOLS_HOME!, "workflows", "wf-persist.json"),
          "utf-8",
        ),
    ).toThrow();

    deleteWorkflowSnapshotFile("wf-persist");
  });

  test("loadWorkflowSnapshot rejects missing, corrupt, and invalid workflow files", () => {
    const home = useIsolatedHome();
    const workflowsDir = join(home, "workflows");

    expect(() => loadWorkflowSnapshot("missing")).toThrow("Unknown workflow");

    writeFileSync(join(workflowsDir, "wf-broken.json"), "{", "utf-8");
    expect(() => loadWorkflowSnapshot("wf-broken")).toThrow(
      "Workflow file is corrupt or unreadable",
    );

    writeFileSync(join(workflowsDir, "wf-invalid.json"), JSON.stringify([]), "utf-8");
    expect(() => loadWorkflowSnapshot("wf-invalid")).toThrow(
      "Workflow file has invalid structure",
    );

    writeFileSync(
      join(workflowsDir, "wf-missing-fields.json"),
      JSON.stringify({ workflowId: "wf-missing-fields" }),
      "utf-8",
    );
    expect(() => loadWorkflowSnapshot("wf-missing-fields")).toThrow(
      "Workflow file has invalid structure",
    );
  });

  test("loadWorkflowSnapshot rejects primitive JSON payloads", () => {
    const home = useIsolatedHome();
    const workflowsDir = join(home, "workflows");

    writeFileSync(join(workflowsDir, "wf-primitive.json"), "42", "utf-8");

    expect(() => loadWorkflowSnapshot("wf-primitive")).toThrow(
      "Workflow file has invalid structure",
    );
  });

  test("loadWorkflowSnapshot accepts supported legacy schema versions and rejects unknown ones", () => {
    const home = useIsolatedHome();
    const workflowsDir = join(home, "workflows");

    writeFileSync(
      join(workflowsDir, "wf-legacy.json"),
      JSON.stringify({
        ...sampleWorkflow("wf-legacy"),
        schemaVersion: LEGACY_WORKFLOW_SNAPSHOT_VERSIONS[0],
      }),
      "utf-8",
    );
    expect(loadWorkflowSnapshot("wf-legacy")).toMatchObject({
      workflowId: "wf-legacy",
      privacyDelayProfile: "off",
      privacyDelayConfigured: false,
    });

    writeFileSync(
      join(workflowsDir, "wf-future.json"),
      JSON.stringify({
        ...sampleWorkflow("wf-future"),
        schemaVersion: "999.0.0",
      }),
      "utf-8",
    );
    expect(() => loadWorkflowSnapshot("wf-future")).toThrow(
      "Workflow file uses an unsupported schema version",
    );
  });

  test("resolveLatestWorkflowId returns the newest readable workflow when unreadable files are definitely older", () => {
    const home = useIsolatedHome();
    const workflowsDir = join(home, "workflows");

    saveWorkflowSnapshot(
      sampleWorkflow("wf-older", {
        updatedAt: "2026-03-24T12:00:00.000Z",
      }),
    );
    saveWorkflowSnapshot(
      sampleWorkflow("wf-newer", {
        updatedAt: "2026-03-24T12:10:00.000Z",
      }),
    );
    const brokenPath = join(workflowsDir, "wf-broken.json");
    writeFileSync(brokenPath, "{", "utf-8");
    utimesSync(
      brokenPath,
      new Date("2026-03-24T11:00:00.000Z"),
      new Date("2026-03-24T11:00:00.000Z"),
    );

    expect(resolveLatestWorkflowId()).toBe("wf-newer");
  });

  test("resolveLatestWorkflowId fails closed when an unreadable workflow could be newer than the latest readable workflow", () => {
    const home = useIsolatedHome();
    const workflowsDir = join(home, "workflows");

    saveWorkflowSnapshot(
      sampleWorkflow("wf-readable", {
        updatedAt: "2026-03-24T12:10:00.000Z",
      }),
    );
    writeFileSync(join(workflowsDir, "wf-broken.json"), "{", "utf-8");

    expect(() => resolveLatestWorkflowId()).toThrow(
      "Cannot resolve 'latest' because one or more saved workflow files are unreadable and could be newer than the latest readable workflow.",
    );
  });

  test("resolveLatestWorkflowId fails when only unreadable workflow files remain", () => {
    const home = useIsolatedHome();
    const workflowsDir = join(home, "workflows");

    writeFileSync(join(workflowsDir, "wf-broken.json"), "{", "utf-8");

    expect(() => resolveLatestWorkflowId()).toThrow(
      "No readable saved workflows found.",
    );
  });

  test("resolveLatestWorkflowId reports no workflows when the workflows directory is absent", () => {
    process.env.PRIVACY_POOLS_HOME = createTrackedTempDir("pp-workflow-no-dir-");

    expect(() => resolveLatestWorkflowId()).toThrow("No saved workflows found");
  });

  test("listSavedWorkflowIds returns readable workflow ids newest-first", () => {
    useIsolatedHome();

    saveWorkflowSnapshot(
      sampleWorkflow("wf-older", {
        updatedAt: "2026-03-24T12:01:00.000Z",
      }),
    );
    saveWorkflowSnapshot(
      sampleWorkflow("wf-newer", {
        updatedAt: "2026-03-24T12:05:00.000Z",
      }),
    );

    expect(listSavedWorkflowIds()).toEqual(["wf-newer", "wf-older"]);
  });

  test("resolveLatestWorkflowId fails closed when a broken symlink workflow could be newer", () => {
    const home = useIsolatedHome();
    const workflowsDir = join(home, "workflows");

    saveWorkflowSnapshot(
      sampleWorkflow("wf-readable", {
        updatedAt: "2026-03-24T12:10:00.000Z",
      }),
    );
    symlinkSync(
      join(home, "missing-workflow.json"),
      join(workflowsDir, "wf-broken-link.json"),
    );

    expect(() => resolveLatestWorkflowId()).toThrow(
      "Cannot resolve 'latest' because one or more saved workflow files are unreadable and could be newer than the latest readable workflow.",
    );
  });

  test("isDepositCheckpointFailure detects explicit workflow checkpoint errors", () => {
    const lastError: FlowLastError = {
      step: "deposit",
      errorCode: "WORKFLOW_DEPOSIT_CHECKPOINT_FAILED",
      errorMessage: "Deposit confirmed onchain but could not checkpoint it locally.",
      retryable: false,
      at: "2026-03-24T12:01:00.000Z",
    };

    expect(isDepositCheckpointFailure(lastError)).toBe(true);
  });

  test("isDepositCheckpointFailure detects legacy checkpoint wording and ignores other steps", () => {
    expect(
      isDepositCheckpointFailure({
        step: "deposit",
        errorCode: "UNKNOWN_ERROR",
        errorMessage: "The transaction hash was not checkpointed locally.",
        retryable: false,
        at: "2026-03-24T12:01:00.000Z",
      }),
    ).toBe(true);

    expect(
      isDepositCheckpointFailure({
        step: "withdraw",
        errorCode: "UNKNOWN_ERROR",
        errorMessage: "The transaction hash was not checkpointed locally.",
        retryable: false,
        at: "2026-03-24T12:01:00.000Z",
      }),
    ).toBe(false);
    expect(isDepositCheckpointFailure(undefined)).toBe(false);
  });

  test("poll delay helpers keep funding and approval phases on their own cadence", () => {
    expect(initialPollDelayMs("awaiting_funding")).toBe(10_000);
    expect(initialPollDelayMs("depositing_publicly")).toBe(10_000);
    expect(initialPollDelayMs("awaiting_asp")).toBe(60_000);

    expect(nextPollDelayMs(45_000, "awaiting_funding")).toBe(60_000);
    expect(nextPollDelayMs(200_000, "awaiting_asp")).toBe(300_000);
  });

  test("humanPollDelayLabel formats seconds and minute pluralization", () => {
    expect(humanPollDelayLabel(45_000)).toBe("45 seconds");
    expect(humanPollDelayLabel(60_000)).toBe("1 minute");
    expect(humanPollDelayLabel(180_000)).toBe("3 minutes");
  });

  test("classifyFlowMutation detects missing, spent, exited, and drifted pool accounts", () => {
    const baseSnapshot = sampleWorkflow("wf-mutation", {
      committedValue: "900",
      depositLabel: "88",
    });

    expect(classifyFlowMutation(baseSnapshot, undefined)).toBe(
      "stopped_external",
    );
    expect(
      classifyFlowMutation(baseSnapshot, samplePoolAccount({ status: "spent" })),
    ).toBe("stopped_external");
    expect(
      classifyFlowMutation(baseSnapshot, samplePoolAccount({ status: "exited" })),
    ).toBe("stopped_external");
    expect(
      classifyFlowMutation(baseSnapshot, samplePoolAccount({ value: 901n })),
    ).toBe("stopped_external");
    expect(
      classifyFlowMutation(baseSnapshot, samplePoolAccount({ label: 89n })),
    ).toBe("stopped_external");
    expect(classifyFlowMutation(baseSnapshot, samplePoolAccount())).toBeNull();
  });

  test("cleanupTerminalWorkflowSecret removes only terminal new-wallet secrets", () => {
    useIsolatedHome();
    saveWorkflowSecretRecord({
      schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
      workflowId: "wf-terminal",
      chain: "mainnet",
      walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
      privateKey: WORKFLOW_SIGNER,
    });
    saveWorkflowSecretRecord({
      schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
      workflowId: "wf-nonterminal",
      chain: "mainnet",
      walletAddress: privateKeyToAccount(CONFIGURED_SIGNER).address,
      privateKey: CONFIGURED_SIGNER,
    });

    cleanupTerminalWorkflowSecret(
      sampleWorkflow("wf-terminal", {
        walletMode: "new_wallet",
        phase: "completed",
      }),
    );
    expect(() => loadWorkflowSecretRecord("wf-terminal")).toThrow(
      "Workflow wallet secret is missing",
    );

    cleanupTerminalWorkflowSecret(
      sampleWorkflow("wf-nonterminal", {
        walletMode: "new_wallet",
        phase: "awaiting_asp",
      }),
    );
    expect(loadWorkflowSecretRecord("wf-nonterminal").privateKey).toBe(
      CONFIGURED_SIGNER,
    );
  });

  test("isTerminalFlowPhase recognizes only terminal workflow phases", () => {
    expect(isTerminalFlowPhase("completed")).toBe(true);
    expect(isTerminalFlowPhase("completed_public_recovery")).toBe(true);
    expect(isTerminalFlowPhase("stopped_external")).toBe(true);
    expect(isTerminalFlowPhase("awaiting_asp")).toBe(false);
  });

  test("buildFlowLastError preserves classified codes and retryability", () => {
    const cliError = new CLIError(
      "Quote failed",
      "RELAYER",
      "retry later",
      "RELAYER_QUOTE_FAILED",
      true,
    );
    const lastError = buildFlowLastError("withdraw", cliError);

    expect(lastError).toMatchObject({
      step: "withdraw",
      errorCode: "RELAYER_QUOTE_FAILED",
      errorMessage: "Quote failed",
      retryable: true,
    });

    const unknownLastError = buildFlowLastError(
      "deposit",
      new Error("unexpected failure"),
    );
    expect(unknownLastError.step).toBe("deposit");
    expect(unknownLastError.errorCode).toBe("UNKNOWN_ERROR");
    expect(unknownLastError.errorMessage).toBe("unexpected failure");
    expect(unknownLastError.retryable).toBe(false);
  });

  test("getFlowSignerPrivateKey loads configured and workflow-wallet signers", () => {
    useIsolatedHome();
    saveSignerKey(CONFIGURED_SIGNER);

    expect(getFlowSignerPrivateKey(sampleWorkflow())).toBe(CONFIGURED_SIGNER);

    saveWorkflowSecretRecord({
      schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
      workflowId: "wf-new-wallet-key",
      chain: "mainnet",
      walletAddress: privateKeyToAccount(WORKFLOW_SIGNER).address,
      privateKey: WORKFLOW_SIGNER,
    });

    expect(
      getFlowSignerPrivateKey(
        normalizeWorkflowSnapshot(
          sampleWorkflow("wf-new-wallet-key", { walletMode: "new_wallet" }),
        ),
      ),
    ).toBe(WORKFLOW_SIGNER);
  });
});
