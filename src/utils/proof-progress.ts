import type { Ora } from "ora";

/** Track whether we've shown the first-run message in this process. */
let firstRunMessageShown = false;

/**
 * Wraps an async proof-generation call with a spinner that shows elapsed time.
 * Prevents the "frozen spinner" effect during 10-30+ second ZK proof generation.
 * On the first proof of the session, adds a brief note that circuits may be downloading.
 */
/** @internal Exported for test isolation only. */
export function resetFirstRunMessage(): void {
  firstRunMessageShown = false;
}

export async function withProofProgress<T>(
  spin: Ora,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  const isFirstRun = !firstRunMessageShown;
  firstRunMessageShown = true;

  spin.text = isFirstRun
    ? `${label}... (first proof may download circuits)`
    : `${label}...`;

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed < 10) {
      spin.text = `${label}... (${elapsed}s)`;
    } else if (elapsed < 30) {
      spin.text = `${label}... (${elapsed}s) - this may take a moment`;
    } else {
      spin.text = `${label}... (${elapsed}s) - almost there`;
    }
  }, 1000);

  try {
    const result = await fn();
    clearInterval(interval);
    return result;
  } catch (error) {
    clearInterval(interval);
    throw error;
  }
}

/**
 * Generic elapsed-time wrapper for any slow async operation.
 *
 * Unlike `withProofProgress`, this has no proof-specific first-run logic.
 * Use for sync, circuit verification, relayer calls, or other operations
 * where a frozen spinner would confuse the user.
 */
export async function withSpinnerProgress<T>(
  spin: Ora,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  spin.text = `${label}...`;

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed < 10) {
      spin.text = `${label}... (${elapsed}s)`;
    } else if (elapsed < 30) {
      spin.text = `${label}... (${elapsed}s) - this may take a moment`;
    } else {
      spin.text = `${label}... (${elapsed}s) - still working`;
    }
  }, 1000);

  try {
    const result = await fn();
    clearInterval(interval);
    return result;
  } catch (error) {
    clearInterval(interval);
    throw error;
  }
}
