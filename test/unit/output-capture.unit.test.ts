import { describe, expect, test } from "bun:test";
import {
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  clearProcessExitCode,
  restoreProcessExitCode,
} from "../helpers/process.ts";

describe("output capture exit-code isolation", () => {
  test("restores process.exitCode after captureAsyncOutput completes", async () => {
    const originalExitCode = process.exitCode;
    clearProcessExitCode();

    try {
      await captureAsyncOutput(async () => {
        process.exitCode = 2;
      });

      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      restoreProcessExitCode(originalExitCode);
    }
  });

  test("captureAsyncOutputAllowExit preserves reported exitCode while restoring global state", async () => {
    const originalExitCode = process.exitCode;
    clearProcessExitCode();

    try {
      const result = await captureAsyncOutputAllowExit(async () => {
        process.exitCode = 5;
      });

      expect(result.exitCode).toBe(5);
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      restoreProcessExitCode(originalExitCode);
    }
  });
});
