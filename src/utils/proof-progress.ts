import type { Ora } from "ora";
import {
  emitProofStreamStage,
  type ProofStreamStage,
} from "./stream-json.js";

/** Track whether we've shown the first-run message in this process. */
let firstRunMessageShown = false;

export interface ProofProgressController {
  readonly isFirstRun: boolean;
  markArtifactVerificationPhase(): void;
  markBuildWitnessPhase(): void;
  markGenerateProofPhase(): void;
  markFinalizeProofPhase(): void;
  markVerifyProofPhase(): void;
}

export interface ProofProgressOptions {
  dynamicSuffix?: (elapsedSeconds: number) => string | null | undefined;
  stream?: {
    enabled?: boolean;
    baseEvent: Record<string, unknown>;
  };
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
  opts: ProofProgressOptions = {},
): Promise<T> {
  const isFirstRun = !firstRunMessageShown;
  firstRunMessageShown = true;
  const phases = isFirstRun
    ? [
        { after: 0, label: "verify circuits if needed", stage: "loading_circuits" as const },
        { after: 8, label: "build witness", stage: "generating_proof" as const },
        { after: 18, label: "generate proof", stage: "generating_proof" as const },
        { after: 35, label: "finalize proof", stage: "generating_proof" as const },
        { after: 42, label: "verify proof", stage: "verifying_proof" as const },
      ]
    : [
        { after: 0, label: "build witness", stage: "generating_proof" as const },
        { after: 10, label: "generate proof", stage: "generating_proof" as const },
        { after: 28, label: "finalize proof", stage: "generating_proof" as const },
        { after: 35, label: "verify proof", stage: "verifying_proof" as const },
      ];
  const start = Date.now();
  let manualPhaseActive = false;
  let manualPhaseLabel = isFirstRun
    ? "verify circuits if needed"
    : "build witness";
  let manualStreamStage: ProofStreamStage = isFirstRun
    ? "loading_circuits"
    : "generating_proof";
  let lastEmittedStreamStage: ProofStreamStage | null = null;

  const currentPhase = (elapsedSeconds: number): {
    label: string;
    stage: ProofStreamStage;
  } => {
    if (manualPhaseActive) {
      return { label: manualPhaseLabel, stage: manualStreamStage };
    }

    const activePhase = phases
      .toReversed()
      .find((phase) => elapsedSeconds >= phase.after);
    return activePhase ?? phases[0]!;
  };

  const emitStage = (stage: ProofStreamStage) => {
    if (lastEmittedStreamStage === stage) {
      return;
    }
    lastEmittedStreamStage = stage;
    emitProofStreamStage(opts.stream?.enabled, opts.stream?.baseEvent, stage);
  };

  const renderProgress = () => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const phase = currentPhase(elapsed);
    emitStage(phase.stage);
    const phaseLabel = phase.label;
    const suffixes = [phaseLabel];
    const dynamicSuffix = opts.dynamicSuffix?.(elapsed)?.trim();
    if (dynamicSuffix) {
      suffixes.push(dynamicSuffix);
    }
    if (elapsed >= 10) {
      suffixes.push("Ctrl-C is safe; nothing has been submitted yet");
    }
    spin.text = `${label}... (${elapsed}s) - ${suffixes.join(" - ")}`;
    if (spin.isSpinning) {
      spin.render();
    }
  };

  const setManualPhase = (
    nextLabel: string,
    nextStage: ProofStreamStage,
    phaseOpts?: { verificationOnly?: boolean },
  ) => {
    if (phaseOpts?.verificationOnly && !isFirstRun) {
      return;
    }
    manualPhaseActive = true;
    manualPhaseLabel = nextLabel;
    manualStreamStage = nextStage;
    renderProgress();
  };

  const progress: ProofProgressController = {
    isFirstRun,
    markArtifactVerificationPhase() {
      setManualPhase("verify circuits if needed", "loading_circuits", { verificationOnly: true });
    },
    markBuildWitnessPhase() {
      setManualPhase("build witness", "generating_proof");
    },
    markGenerateProofPhase() {
      setManualPhase("generate proof", "generating_proof");
    },
    markFinalizeProofPhase() {
      setManualPhase("finalize proof", "generating_proof");
    },
    markVerifyProofPhase() {
      setManualPhase("verify proof", "verifying_proof");
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
