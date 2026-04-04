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
        !testPath.startsWith("./test/acceptance/")
        && !testPath.startsWith("./test/integration/"),
      ),
    ).toBe(true);
    expect(COVERAGE_SIGNAL_TESTS).not.toContain(
      "./test/conformance/root-help-static.conformance.test.ts",
    );
  });

  test("coverage isolated suites stay file-based and self-describing", () => {
    expect(COVERAGE_ISOLATED_SUITES.length).toBeGreaterThan(0);
    expect(new Set(COVERAGE_ISOLATED_SUITES.map((suite) => suite.label)).size).toBe(
      COVERAGE_ISOLATED_SUITES.length,
    );
    for (const suite of COVERAGE_ISOLATED_SUITES) {
      expect(typeof suite.label).toBe("string");
      expect(suite.label.trim().length).toBeGreaterThan(0);
      expect(typeof suite.reason).toBe("string");
      expect(suite.reason.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(suite.timeoutMs)).toBe(true);
      expect(suite.timeoutMs).toBeGreaterThan(0);
      expect(suite.tests.length).toBeGreaterThan(0);
      expect(suite.tests.every((testPath) => testPath.endsWith(".test.ts"))).toBe(
        true,
      );
    }
    expect(COVERAGE_ISOLATED_SUITES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "launcher-routing",
          tests: ["./test/unit/launcher-routing.unit.test.ts"],
        }),
      ]),
    );
  });

  test("default main batches cover each shared target exactly once", () => {
    const flattenedTargets = DEFAULT_MAIN_BATCHES.flatMap((batch) => batch.targets);
    expect(flattenedTargets).toEqual(DEFAULT_MAIN_TEST_TARGETS);
    expect(new Set(DEFAULT_MAIN_BATCHES.map((batch) => batch.label)).size).toBe(
      DEFAULT_MAIN_BATCHES.length,
    );
    expect(DEFAULT_MAIN_BATCHES.every((batch) => batch.targets.length > 0)).toBe(
      true,
    );
  });

  test("default main exclusions isolate the readonly harness but keep split ragequit slices in the main lane", () => {
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(
      "./test/unit/accounts-command-readonly.unit.test.ts",
    );
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(
      "./test/unit/history-command-readonly.unit.test.ts",
    );
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(
      "./test/unit/sync-command-readonly.unit.test.ts",
    );
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(
      "./test/unit/migrate-status-command-readonly.unit.test.ts",
    );
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).not.toContain(
      "./test/unit/ragequit-command-handler.entry-submit.unit.test.ts",
    );
  });
});
