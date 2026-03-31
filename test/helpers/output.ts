/**
 * Shared test helpers for output renderer tests.
 *
 * Provides:
 *   - makeMode(): create a ResolvedGlobalMode with defaults
 *   - captureOutput(): intercept stdout/stderr writes during a function call
 */

import { expect } from "bun:test";
import type { ResolvedGlobalMode } from "../../src/output/common.ts";

const textDecoder = new TextDecoder();
let activeOutputCapture:
  | {
      depth: number;
      origStdout: typeof process.stdout.write;
      origStderr: typeof process.stderr.write;
      stdoutChunks: string[];
      stderrChunks: string[];
    }
  | null = null;

export function makeMode(
  overrides: Partial<ResolvedGlobalMode> = {},
): ResolvedGlobalMode {
  return {
    isAgent: false,
    isJson: false,
    isCsv: false,
    isQuiet: false,
    format: "table" as const,
    skipPrompts: false,
    ...overrides,
  };
}

/** Capture stdout and stderr writes during `fn()`. */
export function captureOutput(fn: () => void): {
  stdout: string;
  stderr: string;
} {
  const capture = beginOutputCapture();
  try {
    fn();
  } finally {
    capture.restore();
  }

  return capture.read();
}

/** Capture stdout and stderr writes during an async `fn()`. */
export async function captureAsyncOutput(
  fn: () => Promise<void>,
): Promise<{
  stdout: string;
  stderr: string;
}> {
  const capture = beginOutputCapture();
  try {
    await fn();
  } finally {
    capture.restore();
  }

  return capture.read();
}

function beginOutputCapture(): {
  restore: () => void;
  read: () => { stdout: string; stderr: string };
} {
  if (!activeOutputCapture) {
    const captureState = {
      depth: 0,
      origStdout: process.stdout.write,
      origStderr: process.stderr.write,
      stdoutChunks: [] as string[],
      stderrChunks: [] as string[],
    };

    process.stdout.write = ((chunk: string | Uint8Array) => {
      captureState.stdoutChunks.push(
        typeof chunk === "string" ? chunk : textDecoder.decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: string | Uint8Array) => {
      captureState.stderrChunks.push(
        typeof chunk === "string" ? chunk : textDecoder.decode(chunk),
      );
      return true;
    }) as typeof process.stderr.write;

    activeOutputCapture = captureState;
  }

  const captureState = activeOutputCapture;
  const startStdoutIndex = captureState.stdoutChunks.length;
  const startStderrIndex = captureState.stderrChunks.length;
  captureState.depth += 1;

  return {
    restore() {
      if (!activeOutputCapture) {
        return;
      }

      activeOutputCapture.depth -= 1;
      if (activeOutputCapture.depth === 0) {
        process.stdout.write = activeOutputCapture.origStdout;
        process.stderr.write = activeOutputCapture.origStderr;
        activeOutputCapture = null;
      }
    },
    read() {
      return {
        stdout: captureState.stdoutChunks.slice(startStdoutIndex).join(""),
        stderr: captureState.stderrChunks.slice(startStderrIndex).join(""),
      };
    },
  };
}

export function parseCapturedJson<T = any>(stdout: string): T {
  return JSON.parse(stdout.trim()) as T;
}

export function captureJsonOutput<T = any>(
  fn: () => void,
): { json: T; stdout: string; stderr: string } {
  const { stdout, stderr } = captureOutput(fn);
  return {
    json: parseCapturedJson<T>(stdout),
    stdout,
    stderr,
  };
}

export async function captureAsyncJsonOutput<T = any>(
  fn: () => Promise<void>,
): Promise<{ json: T; stdout: string; stderr: string }> {
  const { stdout, stderr } = await captureAsyncOutput(fn);
  return {
    json: parseCapturedJson<T>(stdout),
    stdout,
    stderr,
  };
}

class CommandExit extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "CommandExit";
  }
}

export async function captureAsyncOutputAllowExit(
  fn: () => Promise<void>,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const originalExit = process.exit;
  const originalExitCode = process.exitCode;
  let exitCode: number | null = null;
  process.exitCode = 0;

  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new CommandExit(exitCode);
  }) as never;

  try {
    const captured = await captureAsyncOutput(async () => {
      try {
        await fn();
      } catch (error) {
        if (!(error instanceof CommandExit)) {
          throw error;
        }
      }
    });

    return {
      ...captured,
      exitCode: exitCode ?? (process.exitCode && process.exitCode !== 0 ? process.exitCode : null),
    };
  } finally {
    process.exit = originalExit;
    process.exitCode = originalExitCode;
  }
}

export async function captureAsyncJsonOutputAllowExit<T = any>(
  fn: () => Promise<void>,
): Promise<{ json: T; stdout: string; stderr: string; exitCode: number | null }> {
  const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(fn);
  return {
    json: parseCapturedJson<T>(stdout),
    stdout,
    stderr,
    exitCode,
  };
}

export function expectNoStdout(captured: { stdout: string }): void {
  expect(captured.stdout).toBe("");
}

export function expectSilentOutput(captured: {
  stdout: string;
  stderr: string;
}): void {
  expect(captured.stdout).toBe("");
  expect(captured.stderr).toBe("");
}

export function expectStderrOnlyContains(
  captured: { stdout: string; stderr: string },
  expectedFragments: readonly string[],
): void {
  expect(captured.stdout).toBe("");
  for (const fragment of expectedFragments) {
    expect(captured.stderr).toContain(fragment);
  }
}
