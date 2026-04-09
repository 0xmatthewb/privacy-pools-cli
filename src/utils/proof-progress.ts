import type { Ora } from "ora";

/** Track whether we've shown the first-run message in this process. */
let firstRunMessageShown = false;

export interface ProofProgressController {
  readonly isFirstRun: boolean;
  markVerificationPhase(): void;
  markBuildWitnessPhase(): void;
  markGenerateProofPhase(): void;
  markFinalizeProofPhase(): void;
}

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
  phaseLabel?: (elapsedSeconds: number) => string | null;
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
  if (spin.isSpinning) {
    spin.render();
  }

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const phaseLabel = opts?.phaseLabel?.(elapsed);
    if (phaseLabel) {
      spin.text = `${label}... (${elapsed}s) - ${phaseLabel}`;
    } else if (elapsed < 10) {
      spin.text = `${label}... (${elapsed}s)`;
    } else if (elapsed < 30) {
      spin.text = `${label}... (${elapsed}s) - this may take a moment`;
    } else {
      spin.text = `${label}... (${elapsed}s) - ${longLabel}`;
    }
    if (spin.isSpinning) {
      spin.render();
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
 * Shows the first approximate proof phase immediately so the spinner stays
 * informative even when proving blocks the event loop.
 */
export async function withProofProgress<T>(
  spin: Ora,
  label: string,
  fn: (progress: ProofProgressController) => Promise<T>,
): Promise<T> {
  const isFirstRun = !firstRunMessageShown;
  firstRunMessageShown = true;
  const phases = isFirstRun
    ? [
        { after: 0, label: "verify circuits if needed" },
        { after: 8, label: "build witness" },
        { after: 18, label: "generate proof" },
        { after: 35, label: "finalize proof" },
      ]
    : [
        { after: 0, label: "build witness" },
        { after: 10, label: "generate proof" },
        { after: 28, label: "finalize proof" },
      ];
  const start = Date.now();
  let manualPhaseActive = false;
  let manualPhaseLabel = isFirstRun
    ? "verify circuits if needed"
    : "build witness";

  const currentPhaseLabel = (elapsedSeconds: number): string | null => {
    if (manualPhaseActive) {
      return manualPhaseLabel;
    }

    const activePhase = phases
      .toReversed()
      .find((phase) => elapsedSeconds >= phase.after);
    return activePhase?.label ?? null;
  };

  const renderProgress = () => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const phaseLabel = currentPhaseLabel(elapsed);
    if (phaseLabel) {
      spin.text = `${label}... (${elapsed}s) - ${phaseLabel}`;
    } else if (elapsed < 10) {
      spin.text = `${label}... (${elapsed}s)`;
    } else if (elapsed < 30) {
      spin.text = `${label}... (${elapsed}s) - this may take a moment`;
    } else {
      spin.text = `${label}... (${elapsed}s) - almost there`;
    }
    if (spin.isSpinning) {
      spin.render();
    }
  };

  const setManualPhase = (nextLabel: string, opts?: { verificationOnly?: boolean }) => {
    if (opts?.verificationOnly && !isFirstRun) {
      return;
    }
    manualPhaseActive = true;
    manualPhaseLabel = nextLabel;
    renderProgress();
  };

  const progress: ProofProgressController = {
    isFirstRun,
    markVerificationPhase() {
      setManualPhase("verify circuits if needed", { verificationOnly: true });
    },
    markBuildWitnessPhase() {
      setManualPhase("build witness");
    },
    markGenerateProofPhase() {
      setManualPhase("generate proof");
    },
    markFinalizeProofPhase() {
      setManualPhase("finalize proof");
    },
  };

  renderProgress();
  const interval = setInterval(renderProgress, 1000);

  try {
    const result = await fn(progress);
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
  return withElapsedSpinner(spin, label, fn);
}
