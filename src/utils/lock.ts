/**
 * Advisory filesystem lock to prevent concurrent CLI operations
 * from racing on account state files.
 *
 * Uses a PID-based lock file at ~/.privacy-pools/.lock.
 * Stale locks (dead PIDs) are automatically cleaned up.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getConfigDir, ensureConfigDir } from "../services/config.js";
import { CLIError } from "./errors.js";

function getLockFilePath(): string {
  return join(getConfigDir(), ".lock");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire an advisory lock. Throws if another CLI instance holds the lock.
 * Returns a release function that must be called when done.
 */
export function acquireProcessLock(): () => void {
  ensureConfigDir();
  const lockPath = getLockFilePath();

  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, "utf-8").trim();
      const pid = parseInt(content, 10);

      if (!isNaN(pid) && pid > 0 && isProcessAlive(pid) && pid !== process.pid) {
        throw new CLIError(
          "Another privacy-pools operation is in progress.",
          "INPUT",
          "Wait for it to finish, or remove the lock file if the process is stuck: " + lockPath
        );
      }

      // Stale lock from a dead process — remove it
      try { unlinkSync(lockPath); } catch { /* race-safe */ }
    } catch (err) {
      if (err instanceof CLIError) throw err;
      // Corrupt lock file — remove and proceed
      try { unlinkSync(lockPath); } catch { /* race-safe */ }
    }
  }

  // Write our PID
  writeFileSync(lockPath, String(process.pid), { encoding: "utf-8", mode: 0o600 });

  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    try {
      // Only remove if it's still ours
      if (existsSync(lockPath)) {
        const content = readFileSync(lockPath, "utf-8").trim();
        if (content === String(process.pid)) {
          unlinkSync(lockPath);
        }
      }
    } catch {
      // Best effort cleanup
    }
  };

  // Auto-release on exit
  process.on("exit", release);

  return release;
}
