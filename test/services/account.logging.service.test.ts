import { describe, expect, test } from "bun:test";
import { withSuppressedSdkStdout } from "../../src/services/account.ts";

describe("account service stdout guard", () => {
  test("suppresses console.log inside the guard and restores it after", async () => {
    const originalLog = console.log;
    const outerCapture: unknown[][] = [];
    const patchedLog = (...args: unknown[]) => {
      outerCapture.push(args);
    };

    console.log = patchedLog;
    try {
      let logInsideGuard: typeof console.log | undefined;

      await withSuppressedSdkStdout(async () => {
        // Inside the guard, console.log should NOT be our patchedLog —
        // it should be replaced with a no-op so SDK noise is swallowed.
        logInsideGuard = console.log;
        console.log("sdk-noise");
      });

      // The guard must have replaced console.log during execution.
      expect(logInsideGuard).not.toBe(patchedLog);
      // SDK noise must not have reached our outer capture.
      expect(outerCapture.length).toBe(0);
      // After the guard, console.log must be restored to our patchedLog.
      expect(console.log).toBe(patchedLog);
    } finally {
      console.log = originalLog;
    }
  });

  test("restores console.log when guarded call throws", async () => {
    const originalLog = console.log;
    const patchedLog = () => {};

    console.log = patchedLog;
    try {
      const run = withSuppressedSdkStdout(async () => {
        // console.log should be replaced inside the guard even on error path
        expect(console.log).not.toBe(patchedLog);
        throw new Error("boom");
      });
      await expect(run).rejects.toThrow("boom");
      // Must be restored after the error
      expect(console.log).toBe(patchedLog);
    } finally {
      console.log = originalLog;
    }
  });
});
