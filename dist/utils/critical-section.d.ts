/**
 * Defers SIGINT/SIGTERM during critical transaction windows
 * (between on-chain confirmation and local state persistence).
 *
 * If a signal arrives while the guard is active, it is held until
 * `release()` is called, then re-emitted so the process exits cleanly.
 */
export declare function guardCriticalSection(): void;
export declare function releaseCriticalSection(): void;
