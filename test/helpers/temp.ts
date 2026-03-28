import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const trackedTempDirs = new Set<string>();
const TEST_RUN_ID = process.env.PP_TEST_RUN_ID?.trim();

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

process.once("beforeExit", cleanupTrackedTempDirs);
process.once("exit", cleanupTrackedTempDirs);

export function createTrackedTempDir(prefix: string = "pp-test-"): string {
  const effectivePrefix = TEST_RUN_ID ? `${prefix}${TEST_RUN_ID}-` : prefix;
  const dir = mkdtempSync(join(tmpdir(), effectivePrefix));
  trackedTempDirs.add(dir);
  return dir;
}
