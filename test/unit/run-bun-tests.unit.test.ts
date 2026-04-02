import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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
});
