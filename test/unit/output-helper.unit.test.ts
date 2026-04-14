import { describe, expect, test } from "bun:test";
import {
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
  captureOutput,
} from "../helpers/output.ts";

describe("output helper capture guards", () => {
  test("nested captureOutput calls share the same scoped capture cleanly", () => {
    let nested: { stdout: string; stderr: string } | null = null;

    const outer = captureOutput(() => {
      process.stdout.write("outer:");
      nested = captureOutput(() => {
        process.stdout.write("inner");
        process.stderr.write("warn");
      });
      process.stdout.write(":done");
    });

    expect(nested).toEqual({
      stdout: "inner",
      stderr: "warn",
    });
    expect(outer).toEqual({
      stdout: "outer:inner:done",
      stderr: "warn",
    });
  });

  test("captureAsyncOutput fails fast on concurrent top-level capture attempts", async () => {
    let release!: () => void;
    let started!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });

    const firstCapture = captureAsyncOutput(async () => {
      process.stdout.write("first");
      started();
      await releasePromise;
      process.stderr.write("done");
    });

    await startedPromise;

    await expect(
      captureAsyncOutput(async () => {
        process.stdout.write("second");
      }),
    ).rejects.toThrow(
      "Concurrent output capture is not supported. Await the active capture before starting another.",
    );

    release();
    await expect(firstCapture).resolves.toEqual({
      stdout: "first",
      stderr: "done",
    });

    expect(
      captureOutput(() => {
        process.stdout.write("after");
      }),
    ).toEqual({
      stdout: "after",
      stderr: "",
    });
  });

  test("captureAsyncOutputAllowExit restores process.exit when capture setup fails", async () => {
    const originalExit = process.exit;
    const originalExitCode = process.exitCode;
    let release!: () => void;
    let started!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });

    const firstCapture = captureAsyncOutput(async () => {
      started();
      await releasePromise;
    });

    await startedPromise;

    await expect(
      captureAsyncOutputAllowExit(async () => {
        process.exit(9);
      }),
    ).rejects.toThrow(
      "Concurrent output capture is not supported. Await the active capture before starting another.",
    );

    expect(process.exit).toBe(originalExit);
    expect(process.exitCode).toBe(originalExitCode);

    release();
    await firstCapture;
  });
});
