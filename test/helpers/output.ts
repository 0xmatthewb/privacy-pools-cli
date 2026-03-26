/**
 * Shared test helpers for output renderer tests.
 *
 * Provides:
 *   - makeMode(): create a ResolvedGlobalMode with defaults
 *   - captureOutput(): intercept stdout/stderr writes during a function call
 */

import type { ResolvedGlobalMode } from "../../src/output/common.ts";

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
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    );
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    );
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

/** Capture stdout and stderr writes during an async `fn()`. */
export async function captureAsyncOutput(
  fn: () => Promise<void>,
): Promise<{
  stdout: string;
  stderr: string;
}> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    );
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    );
    return true;
  }) as typeof process.stderr.write;

  try {
    await fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }

  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
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
  let exitCode: number | null = null;

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
      exitCode,
    };
  } finally {
    process.exit = originalExit;
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
