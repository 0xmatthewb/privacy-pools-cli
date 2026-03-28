import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";

export type WorkflowSnapshot = Record<string, unknown> & {
  workflowId?: string;
  createdAt?: string;
  updatedAt?: string;
};

function workflowsDir(home: string): string {
  return join(home, ".privacy-pools", "workflows");
}

export function writeWorkflowSnapshot(
  home: string,
  workflowId: string,
  patch: WorkflowSnapshot = {},
): WorkflowSnapshot {
  const snapshot: WorkflowSnapshot = {
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowId,
    createdAt: "2026-03-28T12:00:00.000Z",
    updatedAt: "2026-03-28T12:00:00.000Z",
    phase: "awaiting_asp",
    walletMode: "configured",
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
    ...patch,
  };

  mkdirSync(workflowsDir(home), { recursive: true });
  writeFileSync(
    join(workflowsDir(home), `${workflowId}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );

  return snapshot;
}

function snapshotTimestamp(snapshot: WorkflowSnapshot): number {
  const updatedAt = typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : null;
  const createdAt = typeof snapshot.createdAt === "string" ? snapshot.createdAt : null;
  const parsed = Date.parse(updatedAt ?? createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function readWorkflowSnapshot(home: string, workflowId: string): WorkflowSnapshot {
  return JSON.parse(
    readFileSync(join(workflowsDir(home), `${workflowId}.json`), "utf8"),
  ) as WorkflowSnapshot;
}

function readLatestWorkflowSnapshot(home: string): WorkflowSnapshot | null {
  const workflowDir = workflowsDir(home);
  let entries: string[];
  try {
    entries = readdirSync(workflowDir).filter((entry) => entry.endsWith(".json"));
  } catch {
    return null;
  }

  const snapshots = entries
    .map((entry) => {
      const filePath = join(workflowDir, entry);
      try {
        return JSON.parse(readFileSync(filePath, "utf8")) as WorkflowSnapshot;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is WorkflowSnapshot => entry !== null)
    .sort(
      (left, right) => snapshotTimestamp(right) - snapshotTimestamp(left),
    );

  return snapshots[0] ?? null;
}

export async function waitForWorkflowSnapshotPhase(
  home: string,
  phase: string,
  timeoutMs: number = 60_000,
  intervalMs: number = 250,
): Promise<WorkflowSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = readLatestWorkflowSnapshot(home);
    if (snapshot?.phase === phase) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for workflow phase ${phase}`);
}
