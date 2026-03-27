import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type WorkflowSnapshot = Record<string, unknown> & {
  workflowId?: string;
  createdAt?: string;
  updatedAt?: string;
};

function snapshotTimestamp(snapshot: WorkflowSnapshot): number {
  const updatedAt = typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : null;
  const createdAt = typeof snapshot.createdAt === "string" ? snapshot.createdAt : null;
  const parsed = Date.parse(updatedAt ?? createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function readWorkflowSnapshot(home: string, workflowId: string): WorkflowSnapshot {
  return JSON.parse(
    readFileSync(join(home, ".privacy-pools", "workflows", `${workflowId}.json`), "utf8"),
  ) as WorkflowSnapshot;
}

function readLatestWorkflowSnapshot(home: string): WorkflowSnapshot | null {
  const workflowDir = join(home, ".privacy-pools", "workflows");
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
        return {
          snapshot: JSON.parse(readFileSync(filePath, "utf8")) as WorkflowSnapshot,
          mtimeMs: statSync(filePath).mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { snapshot: WorkflowSnapshot; mtimeMs: number } => entry !== null)
    .sort((left, right) => {
      const timeDiff = snapshotTimestamp(right.snapshot) - snapshotTimestamp(left.snapshot);
      if (timeDiff !== 0) return timeDiff;
      return right.mtimeMs - left.mtimeMs;
    });

  return snapshots[0]?.snapshot ?? null;
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
