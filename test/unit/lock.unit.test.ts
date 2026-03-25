import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { acquireProcessLock } from "../../src/utils/lock.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

function isolatedHome(): string {
  return createTrackedTempDir("pp-lock-test-");
}

describe("acquireProcessLock", () => {
  afterEach(() => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }
    cleanupTrackedTempDirs();
  });

  test("creates lock file and release removes it", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const release = acquireProcessLock();
    const lockPath = join(home, ".lock");

    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf-8").trim()).toBe(String(process.pid));

    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  test("double release is a no-op", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const release = acquireProcessLock();
    release();
    // Second call should not throw
    release();
  });

  test("cleans up stale lock from dead PID and acquires", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const lockPath = join(home, ".lock");

    // Simulate a stale lock from a PID that no longer exists (PID 2 is
    // typically not a user process, and very unlikely to be alive as a
    // privacy-pools instance — but even if it is, we just need it to not
    // be *our* PID). Use a high PID that is almost certainly dead.
    writeFileSync(lockPath, "99999999", { flag: "wx", mode: 0o600 });

    const release = acquireProcessLock();
    expect(readFileSync(lockPath, "utf-8").trim()).toBe(String(process.pid));
    release();
  });

  test("same process can re-acquire after release", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const r1 = acquireProcessLock();
    r1();

    const r2 = acquireProcessLock();
    r2();
  });

  test("nested acquire keeps the lock file until the outer release", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const lockPath = join(home, ".lock");

    const outerRelease = acquireProcessLock();
    const innerRelease = acquireProcessLock();

    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf-8").trim()).toBe(String(process.pid));

    innerRelease();
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf-8").trim()).toBe(String(process.pid));

    outerRelease();
    expect(existsSync(lockPath)).toBe(false);
  });

  test("corrupt lock file (non-numeric) is treated as stale", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const lockPath = join(home, ".lock");

    writeFileSync(lockPath, "not-a-pid", { flag: "wx", mode: 0o600 });

    const release = acquireProcessLock();
    expect(readFileSync(lockPath, "utf-8").trim()).toBe(String(process.pid));
    release();
  });

  test("throws CLIError when lock held by alive foreign PID", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    const lockPath = join(home, ".lock");

    // Write a foreign PID that we'll make appear alive via mock.
    const foreignPid = 99999998;
    writeFileSync(lockPath, String(foreignPid), { flag: "wx", mode: 0o600 });

    // Mock process.kill so signal-0 check reports the PID as alive.
    const killSpy = spyOn(process, "kill").mockImplementation(((pid: number, signal?: number) => {
      if (pid === foreignPid && (signal === 0 || signal === undefined)) return true;
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill);

    try {
      expect(() => acquireProcessLock()).toThrow(CLIError);
      expect(() => acquireProcessLock()).toThrow("Another privacy-pools operation is in progress");
    } finally {
      killSpy.mockRestore();
    }
  });

  test("release is a no-op when lock PID differs from process.pid", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;

    const release = acquireProcessLock();
    const lockPath = join(home, ".lock");
    expect(existsSync(lockPath)).toBe(true);

    // Overwrite the lock content with a different PID
    writeFileSync(lockPath, "12345", { encoding: "utf-8" });

    // Release should skip unlink because PIDs don't match
    release();
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf-8").trim()).toBe("12345");
  });
});
