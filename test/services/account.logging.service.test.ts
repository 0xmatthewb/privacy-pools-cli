import { describe, expect, test } from "bun:test";
import { withSuppressedSdkStdout } from "../../src/services/account.ts";

describe("account service stdout guard", () => {
  test("suppresses only console.log and console.debug during SDK calls", async () => {
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    const originalError = console.error;
    const logCapture: unknown[][] = [];
    const debugCapture: unknown[][] = [];
    const warnCapture: unknown[][] = [];
    const errorCapture: unknown[][] = [];
    const patchedLog = (...args: unknown[]) => { logCapture.push(args); };
    const patchedDebug = (...args: unknown[]) => { debugCapture.push(args); };
    const patchedWarn = (...args: unknown[]) => { warnCapture.push(args); };
    const patchedError = (...args: unknown[]) => { errorCapture.push(args); };

    console.log = patchedLog;
    console.info = originalInfo;
    console.debug = patchedDebug;
    console.warn = patchedWarn;
    console.error = patchedError;
    try {
      let logInsideGuard: typeof console.log | undefined;
      let debugInsideGuard: typeof console.debug | undefined;
      let warnInsideGuard: typeof console.warn | undefined;
      let errorInsideGuard: typeof console.error | undefined;

      await withSuppressedSdkStdout(async () => {
        logInsideGuard = console.log;
        debugInsideGuard = console.debug;
        warnInsideGuard = console.warn;
        errorInsideGuard = console.error;
        console.log("sdk-noise");
        console.debug("sdk-debug-noise");
        console.warn("real-warning");
        console.error("real-error");
      });

      // log and debug must have been replaced (suppressed) during execution.
      expect(logInsideGuard).not.toBe(patchedLog);
      expect(debugInsideGuard).not.toBe(patchedDebug);
      // warn and error must NOT have been replaced — they pass through.
      expect(warnInsideGuard).toBe(patchedWarn);
      expect(errorInsideGuard).toBe(patchedError);
      // SDK chatter via log/debug should not escape the guard.
      expect(logCapture.length).toBe(0);
      expect(debugCapture.length).toBe(0);
      // warn and error should pass through normally.
      expect(warnCapture.length).toBe(1);
      expect(warnCapture[0][0]).toBe("real-warning");
      expect(errorCapture.length).toBe(1);
      expect(errorCapture[0][0]).toBe("real-error");
      // log and debug must be restored after the guard.
      expect(console.log).toBe(patchedLog);
      expect(console.debug).toBe(patchedDebug);
      // warn and error were never touched.
      expect(console.warn).toBe(patchedWarn);
      expect(console.error).toBe(patchedError);
    } finally {
      console.log = originalLog;
      console.info = originalInfo;
      console.debug = originalDebug;
      console.warn = originalWarn;
      console.error = originalError;
    }
  });

  test("restores console methods when guarded call throws", async () => {
    const originalLog = console.log;
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    const originalError = console.error;
    const patchedLog = () => {};
    const patchedDebug = () => {};
    const patchedWarn = () => {};
    const patchedError = () => {};

    console.log = patchedLog;
    console.debug = patchedDebug;
    console.warn = patchedWarn;
    console.error = patchedError;
    try {
      const run = withSuppressedSdkStdout(async () => {
        // log and debug should be suppressed.
        expect(console.log).not.toBe(patchedLog);
        expect(console.debug).not.toBe(patchedDebug);
        // warn and error should be untouched.
        expect(console.warn).toBe(patchedWarn);
        expect(console.error).toBe(patchedError);
        throw new Error("boom");
      });
      await expect(run).rejects.toThrow("boom");
      // log and debug must be restored after the error.
      expect(console.log).toBe(patchedLog);
      expect(console.debug).toBe(patchedDebug);
      // warn and error were never touched.
      expect(console.warn).toBe(patchedWarn);
      expect(console.error).toBe(patchedError);
    } finally {
      console.log = originalLog;
      console.debug = originalDebug;
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
});
