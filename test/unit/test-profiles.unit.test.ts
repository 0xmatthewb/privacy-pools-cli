import { describe, expect, test } from "bun:test";
import {
  resolveProfile,
  TEST_PROFILE_FRAGMENTS,
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
    expect(TEST_PROFILE_FRAGMENTS.install).toEqual([
      ["npm", ["run", "test:smoke"]],
      ["npm", ["run", "test:smoke:native:package"]],
      ["npm", ["run", "test:artifacts:root"]],
      ["npm", ["run", "test:artifacts:host"]],
    ]);
    expect(resolveProfile("install")).toEqual(TEST_PROFILE_FRAGMENTS.install);

    expect(resolveProfile("ci")).toContainEqual(["npm", ["run", "test:install"]]);
    expect(resolveProfile("release")).toContainEqual([
      "npm",
      ["run", "test:install"],
    ]);
    expect(resolveProfile("all")).toContainEqual(["npm", ["run", "test:install"]]);
  });

  test("conformance profiles stay syntax-gated and reference-checked", () => {
    expect(TEST_PROFILE_FRAGMENTS.build).toEqual([
      ["bun", ["run", "build"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["repo-conformance-core"]).toEqual([
      ["npm", ["run", "test:scripts"]],
      ["node", ["scripts/run-conformance-suite.mjs", "core"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["repo-conformance-all"]).toEqual([
      ["npm", ["run", "test:scripts"]],
      ["node", ["scripts/run-conformance-suite.mjs", "all"]],
    ]);
    expect(resolveProfile("conformance")).toEqual([
      ...TEST_PROFILE_FRAGMENTS.build,
      ...TEST_PROFILE_FRAGMENTS["repo-conformance-core"],
    ]);
    expect(resolveProfile("conformance-all")).toEqual([
      ...TEST_PROFILE_FRAGMENTS.build,
      ...TEST_PROFILE_FRAGMENTS["repo-conformance-all"],
    ]);
  });

  test("higher-cost profiles compose native, e2e, and repo-validation fragments", () => {
    expect(TEST_PROFILE_FRAGMENTS["native-core"]).toEqual([
      ["npm", ["run", "test:native:fmt"]],
      ["npm", ["run", "test:native:lint"]],
      ["npm", ["run", "test:native"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS.coverage).toEqual([
      ["npm", ["run", "test:coverage"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["docs-reference-check"]).toEqual([
      ["node", ["scripts/generate-reference.mjs", "--check"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["anvil-smoke"]).toEqual([
      ["npm", ["run", "test:e2e:anvil:smoke"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["anvil-full"]).toEqual([
      ["npm", ["run", "test:e2e:anvil"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["release-bench"]).toEqual([
      ["npm", ["run", "bench:gate:release"]],
    ]);

    expect(resolveProfile("ci")).toContainEqual(["npm", ["run", "test:native"]]);
    expect(resolveProfile("release")).toContainEqual([
      "npm",
      ["run", "test:e2e:anvil:smoke"],
    ]);
    expect(resolveProfile("all")).toContainEqual([
      "npm",
      ["run", "test:e2e:anvil:smoke"],
    ]);
    expect(resolveProfile("release")).toContainEqual([
      "npm",
      ["run", "bench:gate:release"],
    ]);
  });

  test("unknown profiles return null", () => {
    expect(resolveProfile("missing-profile")).toBeNull();
  });
});
