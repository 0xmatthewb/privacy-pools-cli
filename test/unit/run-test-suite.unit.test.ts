import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

const SHARED_SNAPSHOT_PREFIX = "pp-shared-built-workspace-";
const EXPLICIT_TARGET_RUN_ID = "explicit-suite-cleanup";

function listSharedBuiltSnapshots(runId?: string): Set<string> {
  const prefix = runId
    ? `${SHARED_SNAPSHOT_PREFIX}${runId}-`
    : SHARED_SNAPSHOT_PREFIX;
  return new Set(
    readdirSync(tmpdir(), { withFileTypes: true })
      .filter((entry) =>
        entry.isDirectory() && entry.name.startsWith(prefix)
      )
      .map((entry) => entry.name),
  );
}

describe("run test suite", () => {
  test("explicit target runs clean shared built workspace snapshots on success", () => {
    const before = listSharedBuiltSnapshots(EXPLICIT_TARGET_RUN_ID);
    const result = spawnSync(
      process.execPath,
      ["scripts/run-test-suite.mjs", "./test/unit/cli-built-helper.unit.test.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
          PP_TEST_MAIN_CONCURRENCY: "1",
          PP_TEST_RUN_ID: EXPLICIT_TARGET_RUN_ID,
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);

    const after = listSharedBuiltSnapshots(EXPLICIT_TARGET_RUN_ID);
    const leaked = [...after].filter((entry) => !before.has(entry));
    expect(leaked).toEqual([]);
  });
});
