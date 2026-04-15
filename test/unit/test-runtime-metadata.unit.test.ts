import { describe, expect, test } from "bun:test";
import {
  buildRuntimeReport,
  getProfileStepRuntimeBudget,
  getSuiteRuntimeBudget,
  loadRuntimeMetadata,
  mergeRuntimeReportsIntoMetadata,
  reportRuntimeSummary,
  summarizeRuntimeByFile,
  summarizeRuntimeByTag,
} from "../../scripts/test-runtime-metadata.mjs";

describe("test runtime metadata", () => {
  test("loads machine-readable suite and profile budgets from the committed manifest", () => {
    const metadata = loadRuntimeMetadata();

    expect(metadata.version).toBeGreaterThan(0);
    expect(getSuiteRuntimeBudget("packed-smoke")).toBe(180000);
    expect(getSuiteRuntimeBudget("workflow-service")).toBe(120000);
    expect(getProfileStepRuntimeBudget("npm", ["run", "test:install"])).toBe(
      900000,
    );
  });

  test("summarizes runtime totals by tag", () => {
    const summaries = summarizeRuntimeByTag([
      { label: "suite-a", durationMs: 3000, tags: ["native", "expensive"] },
      { label: "suite-b", durationMs: 1000, tags: ["native"] },
      { label: "suite-c", durationMs: 500, tags: ["workflow"] },
    ]);

    expect(summaries).toEqual([
      {
        tag: "native",
        suiteCount: 2,
        durationMs: 4000,
        maxDurationMs: 3000,
        budgetFailureCount: 0,
        averageDurationMs: 2000,
      },
      {
        tag: "expensive",
        suiteCount: 1,
        durationMs: 3000,
        maxDurationMs: 3000,
        budgetFailureCount: 0,
        averageDurationMs: 3000,
      },
      {
        tag: "workflow",
        suiteCount: 1,
        durationMs: 500,
        maxDurationMs: 500,
        budgetFailureCount: 0,
        averageDurationMs: 500,
      },
    ]);
  });

  test("summarizes runtime totals by file from suite test ownership", () => {
    const summaries = summarizeRuntimeByFile([
      {
        label: "main:unit-01",
        durationMs: 400,
        tests: [
          "./test/unit/a.unit.test.ts",
          "./test/unit/b.unit.test.ts",
        ],
      },
      {
        label: "main:unit-02",
        durationMs: 300,
        tests: ["./test/unit/a.unit.test.ts"],
      },
    ]);

    expect(summaries).toEqual([
      {
        path: "./test/unit/a.unit.test.ts",
        estimatedDurationMs: 250,
        sampleCount: 2,
      },
      {
        path: "./test/unit/b.unit.test.ts",
        estimatedDurationMs: 200,
        sampleCount: 1,
      },
    ]);
  });

  test("buildRuntimeReport includes per-file summaries", () => {
    const report = buildRuntimeReport({
      kind: "suite",
      heading: "suites",
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
    });

    expect(report.fileSummaries).toEqual([
      {
        path: "./test/unit/a.unit.test.ts",
        estimatedDurationMs: 200,
        sampleCount: 1,
      },
      {
        path: "./test/unit/b.unit.test.ts",
        estimatedDurationMs: 200,
        sampleCount: 1,
      },
    ]);
  });

  test("reportRuntimeSummary prints suite, tag, and file views", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    };

    reportRuntimeSummary(
      "suite runtimes",
      [
        {
          label: "main:unit-01",
          durationMs: 400,
          tags: ["unit"],
          tests: ["./test/unit/a.unit.test.ts"],
        },
      ],
      stream,
    );

    expect(output).toContain("[perf] suite runtimes");
    expect(output).toContain("[perf] slowest tag totals");
    expect(output).toContain("[perf] slowest file totals");
    expect(output).toContain("file:./test/unit/a.unit.test.ts");
  });

  test("merges suite, profile, and tag timing baselines from emitted reports", () => {
    const metadata = {
      version: 1,
      suiteBudgetsMs: {},
      profileStepBudgetsMs: {},
      suiteTimingBaselinesMs: {},
      profileTimingBaselinesMs: {},
      tagTimingBaselinesMs: {},
    };
    const merged = mergeRuntimeReportsIntoMetadata(metadata, [
      buildRuntimeReport({
        kind: "suite",
        heading: "suites",
        results: [
          {
            label: "packed-smoke",
            canonicalLabel: "packed-smoke",
            durationMs: 1000,
            tags: ["install-boundary", "expensive"],
            tests: ["./test/integration/cli-packaged-smoke.integration.test.ts"],
          },
        ],
      }),
      buildRuntimeReport({
        kind: "profile",
        heading: "profile",
        results: [
          {
            label: "npm run test:install",
            canonicalLabel: "npm run test:install",
            durationMs: 2000,
            tags: ["ci"],
            tests: [],
          },
        ],
      }),
    ]);

    expect(merged.suiteTimingBaselinesMs["packed-smoke"]).toBe(1000);
    expect(merged.profileTimingBaselinesMs["npm run test:install"]).toBe(2000);
    expect(merged.tagTimingBaselinesMs["install-boundary"]).toBe(1000);
    expect(merged.tagTimingBaselinesMs.expensive).toBe(1000);
    expect(merged.tagTimingBaselinesMs.ci).toBe(2000);
  });
});
