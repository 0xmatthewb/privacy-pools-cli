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

import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getConfigDir, ensureConfigDir } from "../services/config.js";
import { CLIError } from "./errors.js";

interface OwnedLock {
  depth: number;
  cleanup: () => void;
}

const ownedLocks = new Map<string, OwnedLock>();

function getLockFilePath(): string {
  return join(getConfigDir(), ".lock");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // On Windows, EPERM means the process exists but we lack permission
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
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
  const existingLock = ownedLocks.get(lockPath);
  if (existingLock) {
    existingLock.depth += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      existingLock.depth -= 1;
      if (existingLock.depth === 0) {
        ownedLocks.delete(lockPath);
        process.removeListener("exit", existingLock.cleanup);
        existingLock.cleanup();
      }
    };
  }

  const pidStr = String(process.pid);

  // Attempt atomic create via 'wx' flag — fails with EEXIST if file exists.
  try {
    writeFileSync(lockPath, pidStr, { flag: "wx", mode: 0o600 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

    // Lock file exists — check if the holder is still alive.
    const pid = readLockPid(lockPath);

    if (pid !== null && pid !== process.pid && isProcessAlive(pid)) {
      throw new CLIError(
        "Another privacy-pools operation is in progress.",
        "INPUT",
        "Wait for it to finish, or remove the lock file if the process is stuck: " + lockPath,
        "LOCK_HELD",
        true,
        undefined,
        { holdingPid: pid, lockPath },
      );
    }

    // Stale or corrupt lock — remove and retry once.
    try { unlinkSync(lockPath); } catch { /* already gone */ }

    try {
      writeFileSync(lockPath, pidStr, { flag: "wx", mode: 0o600 });
    } catch (retryErr: unknown) {
      if ((retryErr as NodeJS.ErrnoException).code === "EEXIST") {
        const retryPid = readLockPid(lockPath);
        throw new CLIError(
          "Another privacy-pools operation is in progress.",
          "INPUT",
          "Wait for it to finish, or remove the lock file if the process is stuck: " + lockPath,
          "LOCK_HELD",
          true,
          undefined,
          { holdingPid: retryPid, lockPath },
        );
      }
      throw retryErr;
    }
  }

  const cleanup = () => {
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

  process.on("exit", cleanup);
  const ownedLock: OwnedLock = {
    depth: 1,
    cleanup,
  };
  ownedLocks.set(lockPath, ownedLock);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    ownedLock.depth -= 1;
    if (ownedLock.depth === 0) {
      ownedLocks.delete(lockPath);
      process.removeListener("exit", cleanup);
      cleanup();
    }
  };

  // Auto-release on exit
  return release;
}
