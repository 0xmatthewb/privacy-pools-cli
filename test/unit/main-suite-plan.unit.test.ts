import { describe, expect, test } from "bun:test";
import {
  buildDefaultMainSuites,
  DEFAULT_MAIN_CONCURRENCY_CAP,
  DEFAULT_MAIN_BATCH_SIZE,
  DEFAULT_ISOLATED_CONCURRENCY_CAP,
  resolveMainBatchConcurrency,
  resolveIsolatedSuiteConcurrency,
  suiteUsesSharedBuiltWorkspaceSnapshot,
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
        tags: [],
        budgetMs: null,
        fixtureClass: null,
      },
      {
        label: "main:unit",
        tests: [
          "./test/unit/beta.unit.test.ts",
          "./test/unit/gamma.unit.test.ts",
        ],
        tags: [],
        budgetMs: null,
        fixtureClass: null,
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
        tags: [],
        budgetMs: null,
        fixtureClass: null,
      },
      {
        label: "main:unit-02",
        tests: ["./test/unit/c.unit.test.ts"],
        tags: [],
        budgetMs: null,
        fixtureClass: null,
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
        tags: [],
        budgetMs: null,
        fixtureClass: null,
      },
      {
        label: "main:unit-02",
        tests: ["./test/unit/b.unit.test.ts"],
        tags: [],
        budgetMs: null,
        fixtureClass: null,
      },
      {
        label: "main:unit-03",
        tests: ["./test/unit/c.unit.test.ts"],
        tags: [],
        budgetMs: null,
        fixtureClass: null,
      },
    ]);
  });

  test("main batches preserve fixture classes for scheduler-aware throttling", () => {
    const suites = buildDefaultMainSuites({
      rootDir: process.cwd(),
      testBatches: [
        {
          label: "acceptance",
          targets: ["./test/acceptance"],
          fixtureClass: "subprocess-boundary",
        },
      ],
      excludedTests: [],
      collectTestFilesFn() {
        return ["./test/acceptance/example.acceptance.test.ts"];
      },
    });

    expect(suites).toEqual([
      {
        label: "main:acceptance",
        tests: ["./test/acceptance/example.acceptance.test.ts"],
        tags: [],
        budgetMs: null,
        fixtureClass: "subprocess-boundary",
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

  test("default main batch size stays positive and larger than one file", () => {
    expect(DEFAULT_MAIN_BATCH_SIZE).toBeGreaterThan(1);
  });

  test("main batch concurrency auto-detect stays bounded", () => {
    expect(
      resolveMainBatchConcurrency({
        suiteCount: 5,
        availableParallelismFn: () => 8,
      }),
    ).toBe(DEFAULT_MAIN_CONCURRENCY_CAP);
  });

  test("main batch concurrency honors explicit env overrides", () => {
    expect(
      resolveMainBatchConcurrency({
        suiteCount: 5,
        env: { PP_TEST_MAIN_CONCURRENCY: "2" },
        availableParallelismFn: () => 8,
      }),
    ).toBe(2);
  });

  test("main batch concurrency ignores invalid env overrides", () => {
    expect(
      resolveMainBatchConcurrency({
        suiteCount: 2,
        env: { PP_TEST_MAIN_CONCURRENCY: "0" },
        availableParallelismFn: () => 1,
      }),
    ).toBe(1);
  });

  test("isolated suite concurrency auto-detect stays bounded", () => {
    expect(
      resolveIsolatedSuiteConcurrency({
        suiteCount: 4,
        availableParallelismFn: () => 8,
      }),
    ).toBe(DEFAULT_ISOLATED_CONCURRENCY_CAP);
  });

  test("isolated suite concurrency honors explicit env overrides", () => {
    expect(
      resolveIsolatedSuiteConcurrency({
        suiteCount: 4,
        env: { PP_TEST_ISOLATED_CONCURRENCY: "3" },
        availableParallelismFn: () => 8,
      }),
    ).toBe(3);
  });

  test("shared built workspace snapshots are reserved for built-cli suites", () => {
    expect(
      suiteUsesSharedBuiltWorkspaceSnapshot([
        "./test/unit/example.unit.test.ts",
        "./test/services/account.service.test.ts",
      ]),
    ).toBe(false);

    expect(
      suiteUsesSharedBuiltWorkspaceSnapshot([
        "./test/acceptance/status-init.acceptance.test.ts",
      ]),
    ).toBe(true);

    expect(
      suiteUsesSharedBuiltWorkspaceSnapshot([
        "./test/integration/cli-flow.integration.test.ts",
      ]),
    ).toBe(true);

    expect(
      suiteUsesSharedBuiltWorkspaceSnapshot([
        "./test/conformance/native-manifest.conformance.test.ts",
      ]),
    ).toBe(true);
  });
});
