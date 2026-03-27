import { describe, expect, test } from "bun:test";
import {
  resolveProfile,
  TEST_PROFILES,
} from "../../scripts/test-profiles.mjs";

describe("test profiles", () => {
  test("publishes the expected top-level profile names", () => {
    expect(Object.keys(TEST_PROFILES).sort()).toEqual([
      "all",
      "ci",
      "conformance",
      "conformance-all",
      "install",
      "release",
    ]);
  });

  test("install profile stays shared across higher-cost profiles", () => {
    expect(resolveProfile("install")).toEqual([
      ["npm", ["run", "test:smoke"]],
      ["npm", ["run", "test:smoke:native:package"]],
      ["npm", ["run", "test:artifacts:host"]],
    ]);

    expect(resolveProfile("ci")).toContainEqual(["npm", ["run", "test:install"]]);
    expect(resolveProfile("release")).toContainEqual([
      "npm",
      ["run", "test:install"],
    ]);
    expect(resolveProfile("all")).toContainEqual(["npm", ["run", "test:install"]]);
  });

  test("conformance profiles stay syntax-gated and reference-checked", () => {
    expect(resolveProfile("conformance")).toEqual([
      ["bun", ["run", "build"]],
      ["npm", ["run", "test:scripts"]],
      ["node", ["scripts/run-conformance-suite.mjs", "core"]],
    ]);
    expect(resolveProfile("conformance-all")).toEqual([
      ["bun", ["run", "build"]],
      ["npm", ["run", "test:scripts"]],
      ["node", ["scripts/run-conformance-suite.mjs", "all"]],
    ]);
  });

  test("unknown profiles return null", () => {
    expect(resolveProfile("missing-profile")).toBeNull();
  });
});
