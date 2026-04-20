import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  elapsedRuntimeMs,
  emitRuntimeDiagnostic,
  isRuntimeDiagnosticsEnabled,
  runtimeStopwatch,
} from "../../src/runtime/diagnostics.ts";

describe("runtime diagnostics", () => {
  afterEach(() => {
    mock.restore();
  });

  test("enables diagnostics only when the debug env is explicitly set to 1", () => {
    expect(isRuntimeDiagnosticsEnabled({ PRIVACY_POOLS_DEBUG_RUNTIME: "1" })).toBe(true);
    expect(isRuntimeDiagnosticsEnabled({ PRIVACY_POOLS_DEBUG_RUNTIME: " 1 " })).toBe(true);
    expect(isRuntimeDiagnosticsEnabled({ PRIVACY_POOLS_DEBUG_RUNTIME: "0" })).toBe(false);
    expect(isRuntimeDiagnosticsEnabled({})).toBe(false);
  });

  test("emits formatted diagnostics and skips undefined payload entries", () => {
    const writes: string[] = [];
    const writeMock = mock((chunk: string) => {
      writes.push(chunk);
      return true;
    });
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = writeMock as typeof process.stderr.write;

    try {
      emitRuntimeDiagnostic(
        "resolve-launch-target",
        {
          route: "native",
          verified: true,
          cache: undefined,
          attempts: 2,
        },
        { PRIVACY_POOLS_DEBUG_RUNTIME: "1" },
      );
      emitRuntimeDiagnostic("silent-path", { route: "js" }, {});
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(writes).toEqual([
      "[privacy-pools runtime] resolve-launch-target route=native verified=true attempts=2\n",
    ]);
  });

  test("runtime stopwatch helpers use hrtime and return milliseconds", () => {
    const originalBigint = process.hrtime.bigint;
    let callCount = 0;
    process.hrtime.bigint = (() => {
      callCount += 1;
      return callCount === 1 ? 5_000_000n : 17_500_000n;
    }) as typeof process.hrtime.bigint;

    try {
      const startedAt = runtimeStopwatch();

      expect(startedAt).toBe(5_000_000n);
      expect(elapsedRuntimeMs(startedAt)).toBe(12.5);
    } finally {
      process.hrtime.bigint = originalBigint;
    }
  });
});
