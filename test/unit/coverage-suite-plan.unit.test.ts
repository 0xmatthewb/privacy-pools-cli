import { describe, expect, test } from "bun:test";
import {
  buildCoverageMainSuites,
  DEFAULT_COVERAGE_MAIN_BATCH_SIZE,
} from "../../scripts/coverage-suite-plan.mjs";

describe("coverage suite planning", () => {
  test("buildCoverageMainSuites filters exclusions, deduplicates files, and batches deterministically", () => {
    const suites = buildCoverageMainSuites({
      rootDir: process.cwd(),
      testTargets: ["./test/unit", "./test/services"],
      commandSurfaceTests: [
        "./test/conformance/root-help-static.conformance.test.ts",
        "./test/conformance/root-help-static.conformance.test.ts",
      ],
      excludedTests: [
        "./test/unit/skip-me.unit.test.ts",
        "./test/services/skip-me.service.test.ts",
      ],
      batchSize: 2,
      collectTestFilesFn(target) {
        if (target === "./test/unit") {
          return [
            "./test/unit/zeta.unit.test.ts",
            "./test/unit/skip-me.unit.test.ts",
            "./test/unit/alpha.unit.test.ts",
          ];
        }
        return [
          "./test/services/beta.service.test.ts",
          "./test/services/skip-me.service.test.ts",
        ];
      },
    });

    expect(suites).toEqual([
      {
        label: "main-01",
        tests: [
          "./test/conformance/root-help-static.conformance.test.ts",
          "./test/services/beta.service.test.ts",
        ],
      },
      {
        label: "main-02",
        tests: [
          "./test/unit/alpha.unit.test.ts",
          "./test/unit/zeta.unit.test.ts",
        ],
      },
    ]);
  });

  test("buildCoverageMainSuites rejects non-positive batch sizes", () => {
    expect(() =>
      buildCoverageMainSuites({
        rootDir: process.cwd(),
        testTargets: ["./test/unit"],
        commandSurfaceTests: [],
        excludedTests: [],
        batchSize: 0,
        collectTestFilesFn() {
          return ["./test/unit/example.unit.test.ts"];
        },
      }),
    ).toThrow("coverage batch size must be a positive integer");
  });

  test("default coverage batch size stays positive and groups multiple files", () => {
    expect(DEFAULT_COVERAGE_MAIN_BATCH_SIZE).toBeGreaterThan(1);
  });
});
