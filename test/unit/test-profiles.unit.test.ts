import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PROFILE_STEP_TIMEOUT_MS,
  resolveProfile,
  resolveProfileRunEnv,
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
      ["node", ["scripts/run-install-profile.mjs"]],
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
      ["npm", ["run", "build"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["repo-conformance-core"]).toEqual([
      ["npm", ["run", "test:scripts"]],
      ["node", ["scripts/run-conformance-suite.mjs", "core"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["repo-conformance-live"]).toEqual([
      ["npm", ["run", "test:scripts"]],
      ["node", ["scripts/run-conformance-suite.mjs", "all"]],
    ]);
    expect(resolveProfile("conformance")).toEqual([
      ...TEST_PROFILE_FRAGMENTS.build,
      ...TEST_PROFILE_FRAGMENTS["repo-conformance-core"],
    ]);
    expect(resolveProfile("conformance-all")).toEqual([
      ...TEST_PROFILE_FRAGMENTS.build,
      ...TEST_PROFILE_FRAGMENTS["repo-conformance-live"],
    ]);
  });

  test("higher-cost profiles compose native, e2e, and repo-validation fragments", () => {
    expect(TEST_PROFILE_FRAGMENTS["native-core"]).toEqual([
      ["npm", ["run", "test:native:fmt"]],
      ["npm", ["run", "test:native:lint"]],
      ["npm", ["run", "test:native"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["native-shell-parity"]).toEqual([
      ["npm", ["run", "test:smoke:native:shell"]],
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
    expect(TEST_PROFILE_FRAGMENTS["anvil-installed-smoke"]).toEqual([
      ["node", ["scripts/run-anvil-smoke.mjs", "--installed-only"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["anvil-full"]).toEqual([
      ["npm", ["run", "test:e2e:anvil"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS["release-bench"]).toEqual([
      ["npm", ["run", "bench:gate:release"]],
    ]);
    expect(TEST_PROFILE_FRAGMENTS.evals).toEqual([
      [
        "node",
        [
          "scripts/run-bun-tests.mjs",
          "./test/evals",
          "--timeout",
          "120000",
          "--process-timeout-ms",
          "600000",
        ],
      ],
    ]);

    expect(resolveProfile("ci")).toContainEqual(["npm", ["run", "test:native"]]);
    expect(resolveProfile("ci")).toContainEqual([
      "npm",
      ["run", "test:smoke:native:shell"],
    ]);
    expect(resolveProfile("ci")).toContainEqual(TEST_PROFILE_FRAGMENTS.evals[0]!);
    expect(resolveProfile("release")).toContainEqual([
      "node",
      ["scripts/run-anvil-smoke.mjs", "--installed-only"],
    ]);
    expect(resolveProfile("release")).toContainEqual(TEST_PROFILE_FRAGMENTS.evals[0]!);
    expect(resolveProfile("release")).toContainEqual([
      "npm",
      ["run", "test:smoke:native:shell"],
    ]);
    expect(resolveProfile("all")).toContainEqual([
      "node",
      ["scripts/run-anvil-smoke.mjs", "--installed-only"],
    ]);
    expect(resolveProfile("all")).toContainEqual(TEST_PROFILE_FRAGMENTS.evals[0]!);
    expect(resolveProfile("all")).toContainEqual([
      "npm",
      ["run", "test:smoke:native:shell"],
    ]);
    expect(resolveProfile("release")).toContainEqual([
      "npm",
      ["run", "bench:gate:release"],
    ]);

    const countBuildSteps = (profileName: "ci" | "release" | "all") =>
      resolveProfile(profileName).filter(([command, args]) => {
        return command === "npm" && args[0] === "run" && args[1] === "build";
      }).length;

    expect(countBuildSteps("ci")).toBe(1);
    expect(countBuildSteps("release")).toBe(1);
    expect(countBuildSteps("all")).toBe(1);
  });

  test("profile runner applies a shared outer watchdog to raw npm/node steps", () => {
    expect(DEFAULT_PROFILE_STEP_TIMEOUT_MS).toBe(1_800_000);
  });

  test("unknown profiles return null", () => {
    expect(resolveProfile("missing-profile")).toBeNull();
  });

  test("profile runner env is sanitized by default", () => {
    const env = resolveProfileRunEnv({
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/tmp/profile-home",
        PRIVACY_POOLS_PRIVATE_KEY:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        PP_RPC_URL: "https://poison.invalid/rpc",
        PP_ANVIL_SHARED_ENV_FILE: "/tmp/shared.env",
        PP_KEEP_COVERAGE_ROOT: "1",
      },
    });

    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/tmp/profile-home");
    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PP_RPC_URL).toBeUndefined();
    expect(env.PP_ANVIL_SHARED_ENV_FILE).toBe("/tmp/shared.env");
    expect(env.PP_KEEP_COVERAGE_ROOT).toBe("1");
  });

  test("profile runner env allows explicit harness overrides", () => {
    const env = resolveProfileRunEnv({
      env: {
        PATH: "/usr/bin:/bin",
        PP_KEEP_COVERAGE_ROOT: "1",
      },
      envOverrides: {
        PP_TEST_RUN_ID: "profile-run",
        PP_KEEP_COVERAGE_ROOT: undefined,
      },
    });

    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.PP_TEST_RUN_ID).toBe("profile-run");
    expect(env.PP_KEEP_COVERAGE_ROOT).toBeUndefined();
  });
});
