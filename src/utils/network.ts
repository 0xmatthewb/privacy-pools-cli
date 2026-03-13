/**
 * Shared network transport error detection and retry logic.
 *
 * Both `services/asp.ts` and `services/relayer.ts` need to classify transient
 * network failures and retry with backoff.  This module extracts the common
 * pieces so each service only handles its own HTTP-layer semantics.
 */

import { CLIError } from "./errors.js";

// ── Transient network error detection ───────────────────────────────────────

const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNRESET",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

const TRANSIENT_MESSAGE_TOKENS: readonly string[] = [
  "fetch",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNRESET",
  "ENETUNREACH",
  "EAI_AGAIN",
  "aborted",
];

/**
 * Returns `true` when `error` looks like a transient network/transport failure
 * that is worth retrying (DNS, TCP, timeouts, fetch failures).
 *
 * Does **not** cover HTTP-status errors — each service adds its own layer for
 * retryable gateway statuses (e.g. 502/504) on top of this check.
 *
 * - `CLIError` is never retryable (already classified).
 * - Non-`Error` values are never retryable.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof CLIError) return false;
  if (!(error instanceof Error)) return false;

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  return (
    error instanceof TypeError ||
    TRANSIENT_MESSAGE_TOKENS.some((token) => error.message.includes(token))
  );
}

// ── Retry with backoff ──────────────────────────────────────────────────────

export interface RetryConfig {
  /** Maximum number of retries (0 = no retries). */
  maxRetries: number;

  /**
   * Return the delay in ms before the `attempt`-th retry (1-indexed).
   * E.g. exponential: `(attempt) => 500 * 2 ** (attempt - 1)`
   */
  delayMs: (attempt: number) => number;

  /**
   * Return `true` for errors that should be retried.
   * Typically wraps `isTransientNetworkError` plus service-specific HTTP errors.
   */
  isRetryable: (error: unknown) => boolean;

  /**
   * Called when all retries are exhausted.
   * Should rethrow a classified `CLIError`.
   */
  onExhausted: (error: unknown) => never;

  /**
   * Optional wait function used between retries.
   * Defaults to `setTimeout`.  Each service can supply its own override
   * (typically via a test helper) so that stubbing ASP retry timing doesn't
   * affect relayer timing and vice versa.
   */
  waitFn?: (ms: number) => Promise<void>;
}

const defaultRetryWait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Execute `request` with automatic retries on transient failures.
 *
 * On each failed attempt the `config.isRetryable` predicate is checked.
 * Non-retryable errors propagate immediately.  When retries are exhausted
 * `config.onExhausted` is called to throw a classified error.
 */
export async function retryWithBackoff<T>(
  request: () => Promise<T>,
  config: RetryConfig,
): Promise<T> {
  const wait = config.waitFn ?? defaultRetryWait;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!config.isRetryable(error)) {
        throw error;
      }

      if (attempt === config.maxRetries) {
        config.onExhausted(error);
      }

      await wait(config.delayMs(attempt + 1));
    }
  }

  // Unreachable — onExhausted always throws.
  throw new CLIError("Unexpected retry loop exit", "UNKNOWN");
}
