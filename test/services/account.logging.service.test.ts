import { describe, expect, test } from "bun:test";
import { withSuppressedSdkStdout } from "../../src/services/account.ts";

describe("account service stdout guard", () => {
  test("suppresses console.log during guarded SDK calls", async () => {
    const originalLog = console.log;
    const captured: unknown[][] = [];
    const patchedLog = (...args: unknown[]) => {
      captured.push(args);
    };

    console.log = patchedLog;
    try {
      await withSuppressedSdkStdout(async () => {
        console.log("sdk-noise");
      });

      expect(captured.length).toBe(0);
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
        throw new Error("boom");
      });
      await expect(run).rejects.toThrow("boom");
      expect(console.log).toBe(patchedLog);
    } finally {
      console.log = originalLog;
    }
  });
});
