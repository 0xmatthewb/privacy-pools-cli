/**
 * Shared test helpers for output renderer tests.
 *
 * Provides:
 *   - makeMode(): create a ResolvedGlobalMode with defaults
 *   - captureOutput(): intercept stdout/stderr writes during a function call
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { expect } from "bun:test";
import type { ResolvedGlobalMode } from "../../src/output/common.ts";
import { configureNextActionGlobals } from "../../src/utils/next-action-globals.ts";
import { restoreProcessExitCode } from "./process.ts";

const textDecoder = new TextDecoder();
const outputCaptureContext = new AsyncLocalStorage<symbol>();
let activeOutputCapture:
  | {
      depth: number;
      ownerToken: symbol;
      origExitCode: number | undefined;
      origStdout: typeof process.stdout.write;
      origStderr: typeof process.stderr.write;
      stdoutChunks: string[];
      stderrChunks: string[];
    }
  | null = null;

export function makeMode(
  overrides: Partial<ResolvedGlobalMode> = {},
): ResolvedGlobalMode {
  configureNextActionGlobals(undefined);
  return {
    isAgent: false,
    isJson: false,
    isCsv: false,
    isWide: false,
    isQuiet: false,
    noProgress: false,
    noHeader: false,
    isVerbose: false,
    verboseLevel: 0,
    format: "table" as const,
    skipPrompts: false,
    jsonFields: null,
    jqExpression: null,
    ...overrides,
  };
}

/** Capture stdout and stderr writes during `fn()`. */
export function captureOutput(fn: () => void): {
  stdout: string;
  stderr: string;
} {
  return withOutputCaptureContext(() => {
    const capture = beginOutputCapture();
    try {
      fn();
    } finally {
      capture.restore();
    }

    return capture.read();
  });
}

/** Capture stdout and stderr writes during an async `fn()`. */
export async function captureAsyncOutput(
  fn: () => Promise<void>,
): Promise<{
  stdout: string;
  stderr: string;
}> {
  return withOutputCaptureContext(async () => {
    const capture = beginOutputCapture();
    try {
      await fn();
    } finally {
      capture.restore();
    }

    return capture.read();
  });
}

function beginOutputCapture(): {
  restore: () => void;
  read: () => { stdout: string; stderr: string };
} {
  const ownerToken = outputCaptureContext.getStore() ?? Symbol("output-capture");
  if (activeOutputCapture && activeOutputCapture.ownerToken !== ownerToken) {
    throw new Error(
      "Concurrent output capture is not supported. Await the active capture before starting another.",
    );
  }

  if (!activeOutputCapture) {
    const captureState = {
      depth: 0,
      ownerToken,
      origExitCode: process.exitCode,
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
        restoreProcessExitCode(activeOutputCapture.origExitCode);
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

function withOutputCaptureContext<T>(fn: () => T): T {
  const existingOwnerToken = outputCaptureContext.getStore();
  if (existingOwnerToken) {
    return fn();
  }

  return outputCaptureContext.run(Symbol("output-capture"), fn);
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
  return withOutputCaptureContext(async () => {
    const capture = beginOutputCapture();
    const originalExit = process.exit;
    const originalExitCode = process.exitCode;
    let exitCode: number | null = null;
    try {
      process.exitCode = 0;
      process.exit = ((code?: number) => {
        exitCode = code ?? 0;
        throw new CommandExit(exitCode);
      }) as never;

      try {
        await fn();
      } catch (error) {
        if (!(error instanceof CommandExit)) {
          throw error;
        }
      }

      return {
        ...capture.read(),
        exitCode: exitCode ?? (process.exitCode ?? 0),
      };
    } finally {
      capture.restore();
      process.exit = originalExit;
      restoreProcessExitCode(originalExitCode);
    }
  });
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
