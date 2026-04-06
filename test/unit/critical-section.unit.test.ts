import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  guardCriticalSection,
  releaseCriticalSection,
} from "../../src/utils/critical-section.ts";

describe("critical section guard", () => {
  // Prevent process.kill from actually sending signals during tests
  const origKill = process.kill;
  beforeEach(() => {
    process.kill = (() => true) as any;
  });
  afterEach(() => {
    process.kill = origKill;
    // Always clean up listeners in case a test fails mid-guard
    releaseCriticalSection();
    releaseCriticalSection();
  });

  test("guardCriticalSection adds SIGINT and SIGTERM listeners", () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    guardCriticalSection();

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    releaseCriticalSection();
  });

  test("releaseCriticalSection removes the added listeners", () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    guardCriticalSection();
    releaseCriticalSection();

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  test("releaseCriticalSection is a no-op when not active", () => {
    const sigintBefore = process.listenerCount("SIGINT");

    // Call release without a preceding guard
    releaseCriticalSection();

    // Listener count is unchanged and no error thrown
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });

  test("double release does not throw or remove extra listeners", () => {
    const sigintBefore = process.listenerCount("SIGINT");

    guardCriticalSection();
    releaseCriticalSection();
    releaseCriticalSection(); // second release should be a safe no-op

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });

  test("guard then release cycle can be repeated", () => {
    const sigintBefore = process.listenerCount("SIGINT");

    guardCriticalSection();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    releaseCriticalSection();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);

    guardCriticalSection();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    releaseCriticalSection();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });

  test("nested guard only releases listeners after final release", () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    guardCriticalSection();
    const sigintAfterFirstGuard = process.listenerCount("SIGINT");
    const sigtermAfterFirstGuard = process.listenerCount("SIGTERM");
    guardCriticalSection();

    // Nested guard should not add duplicate listeners.
    expect(process.listenerCount("SIGINT")).toBe(sigintAfterFirstGuard);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermAfterFirstGuard);

    releaseCriticalSection();
    // After one release, the critical section remains active.
    expect(process.listenerCount("SIGINT")).toBe(sigintAfterFirstGuard);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermAfterFirstGuard);

    releaseCriticalSection();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  test("release calls process.kill when a signal was pending", () => {
    let killCalled = false;
    let killSignal: string | undefined;
    process.kill = ((_pid: number, sig?: string | number) => {
      killCalled = true;
      killSignal = sig as string;
      return true;
    }) as any;

    guardCriticalSection();

    // Simulate a SIGINT arriving while the guard is active
    process.emit("SIGINT", "SIGINT");

    releaseCriticalSection();

    expect(killCalled).toBe(true);
    expect(killSignal).toBe("SIGINT");
  });

  test("release does not call process.kill when no signal was pending", () => {
    let killCalled = false;
    process.kill = (() => {
      killCalled = true;
      return true;
    }) as any;

    guardCriticalSection();
    releaseCriticalSection();

    expect(killCalled).toBe(false);
  });

  test("pending signal is emitted only after final nested release", () => {
    let killCalled = false;
    let killSignal: string | undefined;
    process.kill = ((_pid: number, sig?: string | number) => {
      killCalled = true;
      killSignal = sig as string;
      return true;
    }) as any;

    guardCriticalSection();
    guardCriticalSection();
    process.emit("SIGTERM", "SIGTERM");

    releaseCriticalSection();
    expect(killCalled).toBe(false);

    releaseCriticalSection();
    expect(killCalled).toBe(true);
    expect(killSignal).toBe("SIGTERM");
  });

  test("signal deferred across async gap is re-emitted after release", async () => {
    let killCalled = false;
    let killSignal: string | undefined;
    process.kill = ((_pid: number, sig?: string | number) => {
      killCalled = true;
      killSignal = sig as string;
      return true;
    }) as any;

    guardCriticalSection();

    // Simulate async work with a signal arriving mid-await
    const work = new Promise<void>((resolve) => setTimeout(resolve, 10));
    process.emit("SIGINT", "SIGINT");
    expect(killCalled).toBe(false); // signal is held during guard

    await work;
    expect(killCalled).toBe(false); // still held after async work

    releaseCriticalSection();
    expect(killCalled).toBe(true);
    expect(killSignal).toBe("SIGINT");
  });

  test("signal re-emitted after exception in guarded work (try/finally pattern)", () => {
    let killCalled = false;
    let killSignal: string | undefined;
    process.kill = ((_pid: number, sig?: string | number) => {
      killCalled = true;
      killSignal = sig as string;
      return true;
    }) as any;

    guardCriticalSection();
    process.emit("SIGINT", "SIGINT");

    try {
      throw new Error("simulated failure during state persistence");
    } catch {
      // error handled
    } finally {
      releaseCriticalSection();
    }

    expect(killCalled).toBe(true);
    expect(killSignal).toBe("SIGINT");
  });

  test("second signal overwrites first (last-wins behavior)", () => {
    let killCalled = false;
    let killSignal: string | undefined;
    process.kill = ((_pid: number, sig?: string | number) => {
      killCalled = true;
      killSignal = sig as string;
      return true;
    }) as any;

    guardCriticalSection();
    process.emit("SIGINT", "SIGINT");
    process.emit("SIGTERM", "SIGTERM");

    releaseCriticalSection();
    expect(killCalled).toBe(true);
    expect(killSignal).toBe("SIGTERM"); // last signal wins
  });
});
