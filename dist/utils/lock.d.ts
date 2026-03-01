/**
 * Advisory filesystem lock to prevent concurrent CLI operations
 * from racing on account state files.
 *
 * Uses a PID-based lock file at ~/.privacy-pools/.lock.
 * Stale locks (dead PIDs) are automatically cleaned up.
 */
/**
 * Acquire an advisory lock. Throws if another CLI instance holds the lock.
 * Returns a release function that must be called when done.
 */
export declare function acquireProcessLock(): () => void;
