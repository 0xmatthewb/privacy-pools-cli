/**
 * Shared test helpers for output renderer tests.
 *
 * Provides:
 *   - makeMode(): create a ResolvedGlobalMode with defaults
 *   - captureOutput(): intercept stdout/stderr writes during a function call
 */

import type { ResolvedGlobalMode } from "../../src/output/common.ts";

export function makeMode(overrides: Partial<ResolvedGlobalMode> = {}): ResolvedGlobalMode {
  return {
    isAgent: false,
    isJson: false,
    isQuiet: false,
    skipPrompts: false,
    ...overrides,
  };
}

/** Capture stdout and stderr writes during `fn()`. */
export function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }

  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
}
