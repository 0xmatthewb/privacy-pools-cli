import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { registerProcessExitCleanup } from "../helpers/process.ts";

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
});
