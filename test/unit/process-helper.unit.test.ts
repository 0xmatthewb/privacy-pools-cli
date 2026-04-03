import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import {
  registerProcessExitCleanup,
  terminateChildProcess,
} from "../helpers/process.ts";

describe("process helper exit cleanup", () => {
  test("removes the parent exit listener after cleanup", () => {
    const proc = {
      exitCode: null,
      signalCode: null,
      kill: () => true,
    } as unknown as ChildProcess;

    const before = process.listenerCount("exit");
    const cleanup = registerProcessExitCleanup(proc);

    expect(process.listenerCount("exit")).toBe(before + 1);

    cleanup();

    expect(process.listenerCount("exit")).toBe(before);
  });

  test("terminateChildProcess returns immediately for already-exited children", async () => {
    const proc = {
      exitCode: 0,
      signalCode: null,
      kill: () => {
        throw new Error("kill should not be called");
      },
      once: () => proc,
    } as unknown as ChildProcess;

    await expect(terminateChildProcess(proc)).resolves.toBeUndefined();
  });
});
