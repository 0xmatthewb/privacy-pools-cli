import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAIN_EXCLUDED_TESTS,
  NATIVE_PACKAGE_SMOKE_TEST,
  PACKAGED_SMOKE_TEST,
} from "../../scripts/test-suite-manifest.mjs";

describe("test suite manifest", () => {
  test("default main suite excludes packaged install-smoke lanes", () => {
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(PACKAGED_SMOKE_TEST);
    expect(DEFAULT_MAIN_EXCLUDED_TESTS).toContain(NATIVE_PACKAGE_SMOKE_TEST);
  });
});
