/**
 * Integration test: verifies that concurrent CLI processes contending
 * for the same process lock produce structured errors.
 */

import { describe, test, afterEach, expect } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";

const PROJECT_ROOT = join(import.meta.dir, "../..");

function spawnLockHolder(home: string): ReturnType<typeof spawn> {
  // Write a small script file that bun can run with proper module resolution.
  const scriptPath = join(home, "_lock-holder.ts");
  writeFileSync(scriptPath, `
    import { acquireProcessLock } from "${PROJECT_ROOT}/src/utils/lock.ts";
    process.env.PRIVACY_POOLS_HOME = ${JSON.stringify(home)};
    acquireProcessLock();
    process.stdout.write("LOCKED\\n");
    await new Promise(r => setTimeout(r, 30000));
  `);
  return spawn("bun", ["run", scriptPath], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PRIVACY_POOLS_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Lock holder did not signal LOCKED")), 5000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("LOCKED")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Lock holder exited early with code ${code}`));
    });
  });
}

function collectOutput(child: ReturnType<typeof spawn>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("lock contention across processes", () => {
  let holder: ReturnType<typeof spawn> | null = null;

  afterEach(() => {
    if (holder && !holder.killed) {
      holder.kill("SIGTERM");
    }
    holder = null;
    cleanupTrackedTempDirs();
  });

  test("second process gets structured INPUT error when lock is held", async () => {
    const home = createTrackedTempDir("pp-lock-contention-");
    mkdirSync(home, { recursive: true });

    // Spawn a process that holds the lock.
    holder = spawnLockHolder(home);
    await waitForReady(holder);

    // Spawn a second process that tries to acquire the same lock.
    const contenderScript = join(home, "_lock-contender.ts");
    writeFileSync(contenderScript, `
      import { acquireProcessLock } from "${PROJECT_ROOT}/src/utils/lock.ts";
      process.env.PRIVACY_POOLS_HOME = ${JSON.stringify(home)};
      try {
        acquireProcessLock();
        process.stdout.write(JSON.stringify({ acquired: true }));
      } catch (error: any) {
        process.stdout.write(JSON.stringify({
          acquired: false,
          category: error.category,
          message: error.message,
          code: error.code,
          hint: error.hint,
        }));
      }
    `);
    const contender = spawn("bun", ["run", contenderScript], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PRIVACY_POOLS_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const result = await collectOutput(contender);
    const output = JSON.parse(result.stdout);

    expect(output.acquired).toBe(false);
    expect(output.category).toBe("INPUT");
    expect(output.message).toContain("Another privacy-pools operation is in progress");
    expect(output.hint).toContain(home);
  }, 15_000);
});
