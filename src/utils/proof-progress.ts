import type { Ora } from "ora";

/** Track whether we've shown the first-run message in this process. */
let firstRunMessageShown = false;

/** @internal Exported for test isolation only. */
export function resetFirstRunMessage(): void {
  firstRunMessageShown = false;
}

// ── Shared elapsed-time spinner scaffold ─────────────────────────────────

interface ElapsedSpinnerOptions {
  /** Text shown before the first interval tick (default: `${label}...`). */
  initialText?: string;
  /** Suffix shown after 30+ seconds (default: "still working"). */
  longRunLabel?: string;
}

async function withElapsedSpinner<T>(
  spin: Ora,
  label: string,
  fn: () => Promise<T>,
  opts?: ElapsedSpinnerOptions,
): Promise<T> {
  const start = Date.now();
  const longLabel = opts?.longRunLabel ?? "still working";
  spin.text = opts?.initialText ?? `${label}...`;

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed < 10) {
      spin.text = `${label}... (${elapsed}s)`;
    } else if (elapsed < 30) {
      spin.text = `${label}... (${elapsed}s) - this may take a moment`;
    } else {
      spin.text = `${label}... (${elapsed}s) - ${longLabel}`;
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

// ── Public wrappers ──────────────────────────────────────────────────────

/**
 * Wraps an async proof-generation call with a spinner that shows elapsed time.
 * Prevents the "frozen spinner" effect during 10-30+ second ZK proof generation.
 * On the first proof of the session, adds a brief note that bundled circuits may
 * still be verified before proving begins.
 */
export async function withProofProgress<T>(
  spin: Ora,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const isFirstRun = !firstRunMessageShown;
  firstRunMessageShown = true;
  return withElapsedSpinner(spin, label, fn, {
    initialText: isFirstRun
      ? `${label}... (first proof may verify bundled circuits)`
      : undefined,
    longRunLabel: "almost there",
  });
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
  return withElapsedSpinner(spin, label, fn);
}
