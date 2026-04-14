import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

describe("refresh test shard weights script", () => {
  test("derives deterministic per-file weights from emitted runtime reports", () => {
    const root = mkdtempSync(join(tmpdir(), "pp-shard-refresh-"));
    const outputPath = join(root, "weights.json");
    const reportAPath = join(root, "report-a.json");
    const reportBPath = join(root, "report-b.json");

    writeFileSync(
      reportAPath,
      `${JSON.stringify({
        kind: "suite",
        heading: "suite runtimes",
        results: [
          {
            label: "main:unit-01",
            durationMs: 400,
            tests: [
              "./test/unit/a.unit.test.ts",
              "./test/unit/b.unit.test.ts",
            ],
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      reportBPath,
      `${JSON.stringify({
        kind: "suite",
        heading: "suite runtimes",
        results: [
          {
            label: "main:unit-02",
            durationMs: 300,
            tests: ["./test/unit/a.unit.test.ts"],
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "scripts/ci/refresh-test-shard-weights.mjs",
        "--report",
        reportAPath,
        "--report",
        reportBPath,
        "--output",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Updated shard weights for 2 test file(s)");

    const weights = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(weights).toEqual({
      "./test/unit/a.unit.test.ts": 250,
      "./test/unit/b.unit.test.ts": 200,
    });
  });
});
