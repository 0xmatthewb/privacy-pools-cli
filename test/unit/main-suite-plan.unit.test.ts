import { describe, expect, test } from "bun:test";
import {
  buildDefaultMainSuites,
  DEFAULT_MAIN_BATCH_SIZE,
} from "../../scripts/main-suite-plan.mjs";

describe("main suite planning", () => {
  test("buildDefaultMainSuites filters exclusions, deduplicates files, and shards deterministically", () => {
    const suites = buildDefaultMainSuites({
      rootDir: process.cwd(),
      testBatches: [
        { label: "acceptance", targets: ["./test/acceptance"] },
        { label: "unit", targets: ["./test/unit"] },
      ],
      excludedTests: [
        "./test/acceptance/skip.acceptance.test.ts",
        "./test/unit/skip.unit.test.ts",
      ],
      batchSize: 2,
      collectTestFilesFn(target) {
        if (target === "./test/acceptance") {
          return [
            "./test/acceptance/zeta.acceptance.test.ts",
            "./test/acceptance/skip.acceptance.test.ts",
            "./test/acceptance/alpha.acceptance.test.ts",
          ];
        }

        return [
          "./test/unit/skip.unit.test.ts",
          "./test/unit/gamma.unit.test.ts",
          "./test/unit/beta.unit.test.ts",
          "./test/unit/beta.unit.test.ts",
        ];
      },
    });

    expect(suites).toEqual([
      {
        label: "main:acceptance",
        tests: [
          "./test/acceptance/alpha.acceptance.test.ts",
          "./test/acceptance/zeta.acceptance.test.ts",
        ],
      },
      {
        label: "main:unit",
        tests: [
          "./test/unit/beta.unit.test.ts",
          "./test/unit/gamma.unit.test.ts",
        ],
      },
    ]);
  });

  test("buildDefaultMainSuites adds numbered labels when a batch is split", () => {
    const suites = buildDefaultMainSuites({
      rootDir: process.cwd(),
      testBatches: [{ label: "unit", targets: ["./test/unit"] }],
      excludedTests: [],
      batchSize: 2,
      collectTestFilesFn() {
        return [
          "./test/unit/c.unit.test.ts",
          "./test/unit/a.unit.test.ts",
          "./test/unit/b.unit.test.ts",
        ];
      },
    });

    expect(suites).toEqual([
      {
        label: "main:unit-01",
        tests: [
          "./test/unit/a.unit.test.ts",
          "./test/unit/b.unit.test.ts",
        ],
      },
      {
        label: "main:unit-02",
        tests: ["./test/unit/c.unit.test.ts"],
      },
    ]);
  });

  test("per-target batch sizes override the shared default", () => {
    const suites = buildDefaultMainSuites({
      rootDir: process.cwd(),
      testBatches: [
        { label: "unit", targets: ["./test/unit"], batchSize: 1 },
      ],
      excludedTests: [],
      batchSize: 3,
      collectTestFilesFn() {
        return [
          "./test/unit/c.unit.test.ts",
          "./test/unit/a.unit.test.ts",
          "./test/unit/b.unit.test.ts",
        ];
      },
    });

    expect(suites).toEqual([
      {
        label: "main:unit-01",
        tests: ["./test/unit/a.unit.test.ts"],
      },
      {
        label: "main:unit-02",
        tests: ["./test/unit/b.unit.test.ts"],
      },
      {
        label: "main:unit-03",
        tests: ["./test/unit/c.unit.test.ts"],
      },
    ]);
  });

  test("buildDefaultMainSuites rejects non-positive batch sizes", () => {
    expect(() =>
      buildDefaultMainSuites({
        rootDir: process.cwd(),
        testBatches: [{ label: "unit", targets: ["./test/unit"] }],
        excludedTests: [],
        batchSize: 0,
        collectTestFilesFn() {
          return ["./test/unit/example.unit.test.ts"];
        },
      }),
    ).toThrow("main batch size must be a positive integer");
  });

  test("buildDefaultMainSuites rejects non-positive per-target batch sizes", () => {
    expect(() =>
      buildDefaultMainSuites({
        rootDir: process.cwd(),
        testBatches: [{ label: "unit", targets: ["./test/unit"], batchSize: 0 }],
        excludedTests: [],
        collectTestFilesFn() {
          return ["./test/unit/example.unit.test.ts"];
        },
      }),
    ).toThrow("main batch size must be a positive integer");
  });

  test("default main batch size avoids the previous unit-shard hang", () => {
    expect(DEFAULT_MAIN_BATCH_SIZE).toBe(20);
  });
});
