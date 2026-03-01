/**
 * Advisory filesystem lock to prevent concurrent CLI operations
 * from racing on account state files.
 *
 * Uses a PID-based lock file at ~/.privacy-pools/.lock.
 * Stale locks (dead PIDs) are automatically cleaned up.
 *
 * Lock creation uses O_EXCL (via the 'wx' flag) for atomic
 * create-or-fail semantics, eliminating the TOCTOU race in
 * check-then-create patterns.
 */

import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, constants } from "fs";
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

function readLockPid(lockPath: string): number | null {
  try {
    const content = readFileSync(lockPath, "utf-8").trim();
    const pid = parseInt(content, 10);
    return !isNaN(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Acquire an advisory lock. Throws if another CLI instance holds the lock.
 * Returns a release function that must be called when done.
 */
export function acquireProcessLock(): () => void {
  ensureConfigDir();
  const lockPath = getLockFilePath();
  const pidStr = String(process.pid);

  // Attempt atomic create via O_EXCL — fails with EEXIST if file exists.
  try {
    const fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, pidStr, "utf-8");
    closeSync(fd);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

    // Lock file exists — check if the holder is still alive.
    const pid = readLockPid(lockPath);

    if (pid !== null && pid !== process.pid && isProcessAlive(pid)) {
      throw new CLIError(
        "Another privacy-pools operation is in progress.",
        "INPUT",
        "Wait for it to finish, or remove the lock file if the process is stuck: " + lockPath
      );
    }

    // Stale or corrupt lock — remove and retry once.
    try { unlinkSync(lockPath); } catch { /* already gone */ }

    try {
      const fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      writeFileSync(fd, pidStr, "utf-8");
      closeSync(fd);
    } catch (retryErr: unknown) {
      if ((retryErr as NodeJS.ErrnoException).code === "EEXIST") {
        throw new CLIError(
          "Another privacy-pools operation is in progress.",
          "INPUT",
          "Wait for it to finish, or remove the lock file if the process is stuck: " + lockPath
        );
      }
      throw retryErr;
    }
  }

  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    try {
      // Only remove if it's still ours
      const pid = readLockPid(lockPath);
      if (pid !== null && pid === process.pid) {
        unlinkSync(lockPath);
      }
    } catch {
      // Best effort cleanup
    }
  };

  // Auto-release on exit
  process.on("exit", release);

  return release;
}
