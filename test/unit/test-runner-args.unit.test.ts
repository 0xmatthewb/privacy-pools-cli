import { describe, expect, test } from "bun:test";
import {
  annotateArgs,
  expandPathArgsWithExcludes,
  groupTargetsByIsolation,
  hasExplicitTestTarget,
  hasExplicitTimeoutArg,
  splitExplicitTargets,
} from "../../scripts/test-runner-args.mjs";
import { DEFAULT_TEST_ISOLATED_SUITES } from "../../scripts/test-suite-manifest.mjs";

const ROOT = process.cwd();
const PRELOAD_HELPER = "./test/helpers/temp.ts";
const TEST_FILE = "./test/unit/mode.timeout.unit.test.ts";
const ISOLATED_BOOTSTRAP_TEST = "./test/unit/bootstrap-runtime.unit.test.ts";
const ISOLATED_CLI_MAIN_TEST = "./test/unit/cli-main.coverage.unit.test.ts";

describe("test runner arg helpers", () => {
  test("hasExplicitTimeoutArg detects inline and split timeout flags", () => {
    expect(hasExplicitTimeoutArg([TEST_FILE, "--timeout", "123"])).toBe(true);
    expect(hasExplicitTimeoutArg([TEST_FILE, "--timeout=123"])).toBe(true);
    expect(hasExplicitTimeoutArg([TEST_FILE, "-t", "123"])).toBe(true);
    expect(hasExplicitTimeoutArg([TEST_FILE])).toBe(false);
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
        ISOLATED_BOOTSTRAP_TEST,
        ISOLATED_CLI_MAIN_TEST,
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
      ISOLATED_BOOTSTRAP_TEST,
      ISOLATED_CLI_MAIN_TEST,
    ]);
  });

  test("groupTargetsByIsolation routes isolated targets into manifest-defined suites", () => {
    const grouped = groupTargetsByIsolation(
      [
        TEST_FILE,
        ISOLATED_BOOTSTRAP_TEST,
        ISOLATED_CLI_MAIN_TEST,
      ],
      DEFAULT_TEST_ISOLATED_SUITES,
      ROOT,
    );

    expect(grouped.mainTargets).toEqual([TEST_FILE]);
    expect(grouped.isolatedGroups.map((suite) => suite.label)).toEqual([
      "bootstrap-runtime",
      "cli-main-coverage",
    ]);
    expect(grouped.isolatedGroups.map((suite) => suite.tests)).toEqual([
      [ISOLATED_BOOTSTRAP_TEST],
      [ISOLATED_CLI_MAIN_TEST],
    ]);
  });
});
