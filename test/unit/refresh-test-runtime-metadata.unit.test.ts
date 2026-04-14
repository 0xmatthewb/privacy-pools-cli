import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

describe("refresh test runtime metadata script", () => {
  test("merges emitted suite and profile reports into the committed metadata shape", () => {
    const root = mkdtempSync(join(tmpdir(), "pp-runtime-refresh-"));
    const metadataPath = join(root, "runtime-metadata.json");
    const suiteReportPath = join(root, "suite-report.json");
    const profileReportPath = join(root, "profile-report.json");

    writeFileSync(
      metadataPath,
      `${JSON.stringify({
        version: 1,
        suiteBudgetsMs: {},
        profileStepBudgetsMs: {},
        suiteTimingBaselinesMs: {},
        profileTimingBaselinesMs: {},
        tagTimingBaselinesMs: {},
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      suiteReportPath,
      `${JSON.stringify({
        kind: "suite",
        heading: "suite runtimes",
        tagSummaries: [
          { tag: "integration", durationMs: 1234 },
          { tag: "install-boundary", durationMs: 1234 },
          { tag: "expensive", durationMs: 1234 },
        ],
        results: [
          {
            label: "packed-smoke",
            canonicalLabel: "packed-smoke",
            durationMs: 1234,
            tags: ["integration", "install-boundary", "expensive"],
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      profileReportPath,
      `${JSON.stringify({
        kind: "profile",
        heading: "profile runtimes",
        tagSummaries: [
          { tag: "ci", durationMs: 4321 },
        ],
        results: [
          {
            label: "npm run test:install",
            canonicalLabel: "npm run test:install",
            durationMs: 4321,
            tags: ["ci"],
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "scripts/refresh-test-runtime-metadata.mjs",
        "--file",
        metadataPath,
        "--report",
        suiteReportPath,
        "--report",
        profileReportPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Updated runtime metadata from 2 report(s)");

    const nextMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    expect(nextMetadata.suiteTimingBaselinesMs["packed-smoke"]).toBe(1234);
    expect(nextMetadata.profileTimingBaselinesMs["npm run test:install"]).toBe(
      4321,
    );
    expect(nextMetadata.tagTimingBaselinesMs.integration).toBe(1234);
    expect(nextMetadata.tagTimingBaselinesMs["install-boundary"]).toBe(1234);
    expect(nextMetadata.tagTimingBaselinesMs.expensive).toBe(1234);
    expect(nextMetadata.tagTimingBaselinesMs.ci).toBe(4321);
  });
});
