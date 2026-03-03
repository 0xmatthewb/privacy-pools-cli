import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const trackedTempDirs = new Set<string>();
let cleanupRegistered = false;

export function cleanupTrackedTempDirs(): void {
  for (const dir of trackedTempDirs) {
    try {
      rmSync(dir, {
        recursive: true,
        force: true,
        // Windows can transiently hold handles after child process exits.
        maxRetries: 3,
        retryDelay: 50,
      });
    } catch {
      // Best effort cleanup.
    }
  }
  trackedTempDirs.clear();
}

function ensureCleanupRegistered(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("beforeExit", cleanupTrackedTempDirs);
  process.once("exit", cleanupTrackedTempDirs);
}

export function createTrackedTempDir(prefix: string = "pp-test-"): string {
  ensureCleanupRegistered();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  trackedTempDirs.add(dir);
  return dir;
}
