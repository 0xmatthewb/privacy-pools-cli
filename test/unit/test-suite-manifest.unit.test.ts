import { describe, expect, test } from "bun:test";
import {
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
      "./test/integration/cli-status-init.integration.test.ts",
    );
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).not.toContain(
      "./test/integration/cli-output-mode.integration.test.ts",
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
});
