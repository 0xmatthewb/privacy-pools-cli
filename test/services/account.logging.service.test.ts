import { describe, expect, test } from "bun:test";
import { withSuppressedSdkStdout } from "../../src/services/account.ts";

describe("account service stdout guard", () => {
  test("suppresses console.log and console.debug inside the guard and restores both after", async () => {
    const originalLog = console.log;
    const originalDebug = console.debug;
    const logCapture: unknown[][] = [];
    const debugCapture: unknown[][] = [];
    const patchedLog = (...args: unknown[]) => { logCapture.push(args); };
    const patchedDebug = (...args: unknown[]) => { debugCapture.push(args); };

    console.log = patchedLog;
    console.debug = patchedDebug;
    try {
      let logInsideGuard: typeof console.log | undefined;
      let debugInsideGuard: typeof console.debug | undefined;

      await withSuppressedSdkStdout(async () => {
        logInsideGuard = console.log;
        debugInsideGuard = console.debug;
        console.log("sdk-noise");
        console.debug("sdk-debug-noise");
      });

      // Both must have been replaced during execution.
      expect(logInsideGuard).not.toBe(patchedLog);
      expect(debugInsideGuard).not.toBe(patchedDebug);
      // Neither noise line must have reached outer captures.
      expect(logCapture.length).toBe(0);
      expect(debugCapture.length).toBe(0);
      // Both must be restored after the guard.
      expect(console.log).toBe(patchedLog);
      expect(console.debug).toBe(patchedDebug);
    } finally {
      console.log = originalLog;
      console.debug = originalDebug;
    }
  });

  test("restores console.log and console.debug when guarded call throws", async () => {
    const originalLog = console.log;
    const originalDebug = console.debug;
    const patchedLog = () => {};
    const patchedDebug = () => {};

    console.log = patchedLog;
    console.debug = patchedDebug;
    try {
      const run = withSuppressedSdkStdout(async () => {
        expect(console.log).not.toBe(patchedLog);
        expect(console.debug).not.toBe(patchedDebug);
        throw new Error("boom");
      });
      await expect(run).rejects.toThrow("boom");
      // Both must be restored after the error
      expect(console.log).toBe(patchedLog);
      expect(console.debug).toBe(patchedDebug);
    } finally {
      console.log = originalLog;
      console.debug = originalDebug;
    }
  });
});
