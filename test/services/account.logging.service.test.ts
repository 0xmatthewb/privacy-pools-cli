import { describe, expect, test } from "bun:test";
import { withSuppressedSdkStdout, installSdkConsoleGuard } from "../../src/services/account.ts";

describe("account service stdout guard", () => {
  test("suppresses SDK console noise across stdout and stderr methods", async () => {
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    const originalError = console.error;
    const logCapture: unknown[][] = [];
    const infoCapture: unknown[][] = [];
    const debugCapture: unknown[][] = [];
    const warnCapture: unknown[][] = [];
    const errorCapture: unknown[][] = [];
    const patchedLog = (...args: unknown[]) => { logCapture.push(args); };
    const patchedInfo = (...args: unknown[]) => { infoCapture.push(args); };
    const patchedDebug = (...args: unknown[]) => { debugCapture.push(args); };
    const patchedWarn = (...args: unknown[]) => { warnCapture.push(args); };
    const patchedError = (...args: unknown[]) => { errorCapture.push(args); };

    console.log = patchedLog;
    console.info = patchedInfo;
    console.debug = patchedDebug;
    console.warn = patchedWarn;
    console.error = patchedError;
    try {
      let logInsideGuard: typeof console.log | undefined;
      let infoInsideGuard: typeof console.info | undefined;
      let debugInsideGuard: typeof console.debug | undefined;
      let warnInsideGuard: typeof console.warn | undefined;
      let errorInsideGuard: typeof console.error | undefined;

      await withSuppressedSdkStdout(async () => {
        logInsideGuard = console.log;
        infoInsideGuard = console.info;
        debugInsideGuard = console.debug;
        warnInsideGuard = console.warn;
        errorInsideGuard = console.error;
        console.log("sdk-noise");
        console.info("sdk-info-noise");
        console.debug("sdk-debug-noise");
        console.warn("sdk-warn-noise");
        console.error("sdk-error-noise");
      });

      // All console methods must have been replaced during execution.
      expect(logInsideGuard).not.toBe(patchedLog);
      expect(infoInsideGuard).not.toBe(patchedInfo);
      expect(debugInsideGuard).not.toBe(patchedDebug);
      expect(warnInsideGuard).not.toBe(patchedWarn);
      expect(errorInsideGuard).not.toBe(patchedError);
      // No SDK chatter should escape the guard.
      expect(logCapture.length).toBe(0);
      expect(infoCapture.length).toBe(0);
      expect(debugCapture.length).toBe(0);
      expect(warnCapture.length).toBe(0);
      expect(errorCapture.length).toBe(0);
      // All console methods must be restored after the guard.
      expect(console.log).toBe(patchedLog);
      expect(console.info).toBe(patchedInfo);
      expect(console.debug).toBe(patchedDebug);
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
    const originalInfo = console.info;
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    const originalError = console.error;
    const patchedLog = () => {};
    const patchedInfo = () => {};
    const patchedDebug = () => {};
    const patchedWarn = () => {};
    const patchedError = () => {};

    console.log = patchedLog;
    console.info = patchedInfo;
    console.debug = patchedDebug;
    console.warn = patchedWarn;
    console.error = patchedError;
    try {
      const run = withSuppressedSdkStdout(async () => {
        expect(console.log).not.toBe(patchedLog);
        expect(console.info).not.toBe(patchedInfo);
        expect(console.debug).not.toBe(patchedDebug);
        expect(console.warn).not.toBe(patchedWarn);
        expect(console.error).not.toBe(patchedError);
        throw new Error("boom");
      });
      await expect(run).rejects.toThrow("boom");
      // All console methods must be restored after the error.
      expect(console.log).toBe(patchedLog);
      expect(console.info).toBe(patchedInfo);
      expect(console.debug).toBe(patchedDebug);
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
});

describe("installSdkConsoleGuard", () => {
  test("permanently silences console methods", () => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const origInfo = console.info;
    const origDebug = console.debug;
    try {
      installSdkConsoleGuard();

      // All methods should now be no-ops (not the originals).
      expect(console.log).not.toBe(origLog);
      expect(console.warn).not.toBe(origWarn);
      expect(console.error).not.toBe(origError);

      // Calling them should not throw.
      console.log("silenced");
      console.warn("silenced");
      console.error("silenced");
      console.info("silenced");
      console.debug("silenced");
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      console.info = origInfo;
      console.debug = origDebug;
    }
  });
});
