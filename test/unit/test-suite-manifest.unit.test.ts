import { describe, expect, test } from "bun:test";
import {
  COVERAGE_ISOLATED_SUITES,
  COVERAGE_SIGNAL_TESTS,
  DEFAULT_MAIN_BATCHES,
  DEFAULT_MAIN_EXCLUDED_TESTS,
  DEFAULT_MAIN_TEST_TARGETS,
  NATIVE_PACKAGE_SMOKE_TEST,
  NATIVE_SHELL_SMOKE_TEST,
  PACKAGED_SMOKE_TEST,
} from "../../scripts/test-suite-manifest.mjs";

describe("test suite manifest", () => {
  test("default main suite exclusions stay focused on dedicated smoke and isolated lanes", () => {
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(PACKAGED_SMOKE_TEST);
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(NATIVE_PACKAGE_SMOKE_TEST);
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(NATIVE_SHELL_SMOKE_TEST);
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).not.toContain(
      "./test/acceptance/status-init.acceptance.test.ts",
    );
  });

  test("coverage signal tests stay focused on in-process contract coverage", () => {
    expect(COVERAGE_SIGNAL_TESTS.length).toBeGreaterThan(0);
    expect(
      COVERAGE_SIGNAL_TESTS.every((testPath) =>
        testPath.startsWith("./test/conformance/"),
      ),
    ).toBe(true);
  });

  test("coverage isolated suites stay file-based and include the split deterministic lanes", () => {
    expect(
      COVERAGE_ISOLATED_SUITES.every((suite) =>
        Array.isArray(suite.tests)
        && suite.tests.length > 0
        && suite.tests.every((testPath) => testPath.endsWith(".test.ts")),
      ),
    ).toBe(true);
    expect(COVERAGE_ISOLATED_SUITES.flatMap((suite) => suite.tests)).toContain(
      "./test/unit/init-command-interactive.cancel-invalid.unit.test.ts",
    );
    expect(COVERAGE_ISOLATED_SUITES.flatMap((suite) => suite.tests)).toContain(
      "./test/unit/ragequit-command-handler.entry-submit.unit.test.ts",
    );
    expect(COVERAGE_ISOLATED_SUITES.flatMap((suite) => suite.tests)).toContain(
      "./test/unit/accounts-command-readonly.unit.test.ts",
    );
  });

  test("default main batches cover each shared target exactly once", () => {
    const flattenedTargets = DEFAULT_MAIN_BATCHES.flatMap((batch) => batch.targets);
    expect(flattenedTargets).toEqual(DEFAULT_MAIN_TEST_TARGETS);
    expect(DEFAULT_MAIN_BATCHES.map((batch) => batch.label)).toEqual([
      "acceptance",
      "unit",
      "integration",
      "fuzz",
      "services",
    ]);
  });

  test("default main exclusions leave the split readonly and ragequit suites in the main lane unless isolation is required", () => {
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).not.toContain(
      "./test/unit/accounts-command-readonly.unit.test.ts",
    );
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).not.toContain(
      "./test/unit/ragequit-command-handler.entry-submit.unit.test.ts",
    );
  });
});
