import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("run-bun-tests outer watchdog", () => {
  test("fails boundedly when the Bun process wedges after the test body completes", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/run-bun-tests.mjs",
        "./test/fixtures/bun-process-hang.fixture.ts",
        "--timeout",
        "60000",
        "--process-timeout-ms",
        "1500",
      ],
      {
        cwd: CLI_ROOT,
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("outer process timeout");
    expect(result.stderr).toContain("bun-process-hang.fixture.ts");
  });

  test("direct bun test exits cleanly when shared output capture restores exitCode", () => {
    const result = spawnSync(
      "bun",
      ["test", "./test/fixtures/bun-exit-code-leak.fixture.ts"],
      {
        cwd: CLI_ROOT,
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    expect(result.status).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("2 pass");
    expect(`${result.stdout}\n${result.stderr}`).toContain("0 fail");
  });

  test("propagates real failing Bun exits without summary-based normalization", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/run-bun-tests.mjs",
        "./test/fixtures/bun-failing.fixture.ts",
        "--timeout",
        "60000",
        "--process-timeout-ms",
        "10000",
      ],
      {
        cwd: CLI_ROOT,
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("1 fail");
  });

  test("streams Bun output before the runner exits", async () => {
    const child = spawn(
      "node",
      [
        "scripts/run-bun-tests.mjs",
        "./test/fixtures/bun-streaming.fixture.ts",
        "--timeout",
        "60000",
        "--process-timeout-ms",
        "10000",
      ],
      {
        cwd: CLI_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    let stdout = "";
    let stderr = "";
    let firstSentinelAt = null;
    const startedAt = Date.now();

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (firstSentinelAt === null && stdout.includes("stream-ready")) {
        firstSentinelAt = Date.now();
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    const { status, signal, closedAt } = await new Promise(
      (resolve, reject) => {
        const watchdog = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("run-bun-tests.mjs streaming check timed out"));
        }, 15000);

        child.once("error", (error) => {
          clearTimeout(watchdog);
          reject(error);
        });
        child.once("close", (code, closeSignal) => {
          clearTimeout(watchdog);
          resolve({
            status: code,
            signal: closeSignal,
            closedAt: Date.now(),
          });
        });
      },
    );

    expect(signal).toBeNull();
    expect(status).toBe(0);
    expect(stdout).toContain("stream-ready");
    expect(`${stdout}\n${stderr}`).toContain("1 pass");
    expect(firstSentinelAt).not.toBeNull();
    expect(firstSentinelAt).toBeGreaterThanOrEqual(startedAt);
    expect(closedAt - firstSentinelAt).toBeGreaterThan(300);
  });
});
