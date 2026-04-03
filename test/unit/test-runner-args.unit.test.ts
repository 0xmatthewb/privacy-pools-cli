import { describe, expect, test } from "bun:test";
import {
  annotateArgs,
  extractProcessTimeoutArg,
  expandPathArgsWithExcludes,
  groupTargetsByIsolation,
  hasExplicitProcessTimeoutArg,
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
  splitExplicitTargets,
} from "../../scripts/test-runner-args.mjs";
import {
  COVERAGE_ISOLATED_SUITES,
  DEFAULT_TEST_ISOLATED_SUITES,
} from "../../scripts/test-suite-manifest.mjs";

const ROOT = process.cwd();
const PRELOAD_HELPER = "./test/helpers/temp.ts";
const TEST_FILE = "./test/unit/mode.timeout.unit.test.ts";
const ISOLATED_PROOFS_TEST = "./test/services/proofs.service.test.ts";
const ISOLATED_WORKFLOW_INTERNAL_TEST =
  "./test/services/workflow.internal.service.test.ts";

describe("test runner arg helpers", () => {
  test("hasExplicitTimeoutArg detects inline and split timeout flags", () => {
    expect(hasExplicitTimeoutArg([TEST_FILE, "--timeout", "123"])).toBe(true);
    expect(hasExplicitTimeoutArg([TEST_FILE, "--timeout=123"])).toBe(true);
    expect(hasExplicitTimeoutArg([TEST_FILE, "-t", "focused test"])).toBe(
      false,
    );
    expect(hasExplicitTimeoutArg([TEST_FILE])).toBe(false);
  });

  test("hasExplicitProcessTimeoutArg detects inline and split watchdog flags", () => {
    expect(
      hasExplicitProcessTimeoutArg(
        [TEST_FILE, "--process-timeout-ms", "600000"],
      ),
    ).toBe(true);
    expect(
      hasExplicitProcessTimeoutArg([TEST_FILE, "--process-timeout-ms=600000"]),
    ).toBe(true);
    expect(hasExplicitProcessTimeoutArg([TEST_FILE, "--timeout", "123"])).toBe(
      false,
    );
    expect(hasExplicitProcessTimeoutArg([TEST_FILE])).toBe(false);
  });

  test("extractProcessTimeoutArg removes the watchdog flag and keeps the selected budget", () => {
    expect(
      extractProcessTimeoutArg(
        [TEST_FILE, "--process-timeout-ms", "600000"],
        900000,
      ),
    ).toEqual({
      args: [TEST_FILE],
      processTimeoutMs: 600000,
    });

    expect(
      extractProcessTimeoutArg(
        [TEST_FILE, "--process-timeout-ms=700000"],
        900000,
      ),
    ).toEqual({
      args: [TEST_FILE],
      processTimeoutMs: 700000,
    });

    expect(extractProcessTimeoutArg([TEST_FILE], 900000)).toEqual({
      args: [TEST_FILE],
      processTimeoutMs: 900000,
    });
  });

  test("hasExplicitTestTarget ignores values consumed by Bun flags", () => {
    expect(
      hasExplicitTestTarget(["--preload", PRELOAD_HELPER, "--timeout=1"], ROOT),
    ).toBe(false);
    expect(
      hasExplicitTestTarget(
        ["--coverage-reporter", "lcov", "--timeout=1"],
        ROOT,
      ),
    ).toBe(false);
    expect(
      hasExplicitTestTarget(["--exclude", TEST_FILE, "--timeout=1"], ROOT),
    ).toBe(false);
    expect(
      hasExplicitTestTarget(["--preload", PRELOAD_HELPER, TEST_FILE], ROOT),
    ).toBe(true);
  });

  test("annotateArgs marks flag values so they are not treated as test targets", () => {
    expect(
      annotateArgs(["--preload", PRELOAD_HELPER, TEST_FILE]),
    ).toEqual([
      { token: "--preload", consumedAsValue: false },
      { token: PRELOAD_HELPER, consumedAsValue: true },
      { token: TEST_FILE, consumedAsValue: false },
    ]);
  });

  test("expandPathArgsWithExcludes preserves path-valued flags", () => {
    const expanded = expandPathArgsWithExcludes(
      ["--preload", PRELOAD_HELPER, TEST_FILE],
      new Set(),
      (pathArg) => [`EXPANDED:${pathArg}`],
      ROOT,
    );

    expect(expanded).toEqual([
      "--preload",
      PRELOAD_HELPER,
      `EXPANDED:${TEST_FILE}`,
    ]);
  });

  test("splitExplicitTargets preserves shared args and expands explicit test files", () => {
    const split = splitExplicitTargets(
      [
        "--coverage-reporter",
        "lcov",
        "--exclude",
        TEST_FILE,
        ISOLATED_PROOFS_TEST,
        ISOLATED_WORKFLOW_INTERNAL_TEST,
      ],
      (pathArg) => [pathArg],
      ROOT,
    );

    expect(split.sharedArgs).toEqual([
      "--coverage-reporter",
      "lcov",
      "--exclude",
      TEST_FILE,
    ]);
    expect(split.targetFiles).toEqual([
      ISOLATED_PROOFS_TEST,
      ISOLATED_WORKFLOW_INTERNAL_TEST,
    ]);
  });

  test("groupTargetsByIsolation routes isolated targets into manifest-defined suites", () => {
    const grouped = groupTargetsByIsolation(
      [
        TEST_FILE,
        ISOLATED_PROOFS_TEST,
        ISOLATED_WORKFLOW_INTERNAL_TEST,
      ],
      DEFAULT_TEST_ISOLATED_SUITES,
      ROOT,
    );

    expect(grouped.mainTargets).toEqual([TEST_FILE]);
    expect(grouped.isolatedGroups.map((suite) => suite.label)).toEqual([
      "proofs-service",
      "workflow-internal",
    ]);
    expect(grouped.isolatedGroups.map((suite) => suite.tests)).toEqual([
      [ISOLATED_PROOFS_TEST],
      [ISOLATED_WORKFLOW_INTERNAL_TEST],
    ]);
  });

  test("remaining isolated suites document a concrete isolation reason", () => {
    expect(DEFAULT_TEST_ISOLATED_SUITES.length).toBeGreaterThan(0);
    for (const suite of DEFAULT_TEST_ISOLATED_SUITES) {
      expect(typeof suite.reason).toBe("string");
      expect(suite.reason?.trim().length).toBeGreaterThan(0);
    }
  });

  test("default isolation policy matches the Bun-aware final suite set", () => {
    const labels = DEFAULT_TEST_ISOLATED_SUITES.map((suite) => suite.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const requiredLabel of [
      "contracts-service",
      "proofs-service",
      "workflow-mocked",
      "workflow-internal",
      "bootstrap-runtime",
    ]) {
      expect(labels).toContain(requiredLabel);
    }
    expect(labels).not.toContain("workflow-service");
  });

  test("coverage isolation keeps only the final documented superset", () => {
    const defaultLabels = DEFAULT_TEST_ISOLATED_SUITES.map((suite) => suite.label);
    const coverageLabels = COVERAGE_ISOLATED_SUITES.map((suite) => suite.label);

    expect(new Set(coverageLabels).size).toBe(coverageLabels.length);
    for (const label of defaultLabels) {
      expect(coverageLabels).toContain(label);
    }
    for (const coverageOnlyLabel of [
      "workflow-service",
      "launcher-runtime",
    ]) {
      expect(coverageLabels).toContain(coverageOnlyLabel);
    }
    expect(defaultLabels).toContain("account-readonly");
    expect(coverageLabels).toContain("account-readonly");
  });
});
