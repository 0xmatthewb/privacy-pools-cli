import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PROFILE_STEP_TIMEOUT_MS,
  resolveProfile,
  resolveProfileRunEnv,
  TEST_PROFILES,
} from "../../scripts/test-profiles.mjs";

function hasStep(
  profile: ReadonlyArray<[string, string[]]>,
  command: string,
  args: string[],
) {
  return profile.some(([profileCommand, profileArgs]) =>
    profileCommand === command
    && profileArgs.length === args.length
    && profileArgs.every((arg, index) => arg === args[index])
  );
}

describe("test profiles", () => {
  test("publishes the expected top-level profile names", () => {
    const profileNames = Object.keys(TEST_PROFILES);
    expect(profileNames).toEqual(
      expect.arrayContaining([
        "all",
        "ci",
        "conformance",
        "conformance-all",
        "install",
        "release",
      ]),
    );
    expect(new Set(profileNames).size).toBe(profileNames.length);
  });

  test("install profile stays reusable across higher-cost profiles", () => {
    expect(resolveProfile("install")).toEqual([
      ["node", ["scripts/run-install-profile.mjs"]],
    ]);

    for (const profileName of ["ci", "release", "all"] as const) {
      expect(hasStep(resolveProfile(profileName) ?? [], "npm", [
        "run",
        "test:install",
      ])).toBe(true);
    }
  });

  test("conformance profiles keep the build and conformance contracts", () => {
    const conformance = resolveProfile("conformance") ?? [];
    const conformanceAll = resolveProfile("conformance-all") ?? [];
    const release = resolveProfile("release") ?? [];

    expect(hasStep(conformance, "npm", ["run", "build"])).toBe(true);
    expect(hasStep(conformance, "npm", ["run", "test:scripts"])).toBe(true);
    expect(
      hasStep(conformance, "node", ["scripts/run-conformance-suite.mjs", "core"]),
    ).toBe(true);
    expect(
      hasStep(conformanceAll, "node", ["scripts/run-conformance-suite.mjs", "all"]),
    ).toBe(true);
    expect(
      hasStep(release, "node", ["scripts/run-conformance-suite.mjs", "all"]),
    ).toBe(true);
  });

  test("ci and release profiles keep the high-cost verification lanes", () => {
    const ci = resolveProfile("ci") ?? [];
    const release = resolveProfile("release") ?? [];
    const all = resolveProfile("all") ?? [];

    expect(hasStep(ci, "npm", ["test"])).toBe(true);
    expect(hasStep(ci, "npm", ["run", "test:coverage:native"])).toBe(true);
    expect(hasStep(ci, "npm", ["run", "test:coverage"])).toBe(true);
    expect(hasStep(ci, "npm", ["run", "test:native"])).toBe(true);
    expect(hasStep(ci, "npm", ["run", "test:smoke:native:shell"])).toBe(true);
    expect(hasStep(ci, "npm", ["run", "test:e2e:anvil:smoke"])).toBe(true);
    expect(hasStep(ci, "npm", ["run", "test:evals"])).toBe(true);
    expect(hasStep(ci, "npm", ["run", "docs:check"])).toBe(true);

    expect(hasStep(release, "npm", ["run", "test:e2e:anvil"])).toBe(true);
    expect(hasStep(release, "npm", ["run", "test:coverage:native"])).toBe(
      true,
    );
    expect(
      hasStep(release, "node", ["scripts/run-anvil-smoke.mjs", "--installed-only"]),
    ).toBe(true);
    expect(hasStep(release, "npm", ["run", "bench:gate:release"])).toBe(true);
    expect(hasStep(release, "npm", ["run", "bench:gate:readonly"])).toBe(true);
    expect(hasStep(release, "npm", ["run", "test:smoke:native:shell"])).toBe(
      true,
    );
    expect(hasStep(release, "npm", ["run", "test:evals"])).toBe(true);
    for (const [command, args] of release) {
      expect(hasStep(all, command, args)).toBe(true);
    }
    expect(all.length).toBeGreaterThanOrEqual(release.length);

    const countBuildSteps = (profileName: "ci" | "release" | "all") =>
      (resolveProfile(profileName) ?? []).filter(([command, args]) => {
        return command === "npm" && args[0] === "run" && args[1] === "build";
      }).length;

    expect(countBuildSteps("ci")).toBe(0);
    expect(countBuildSteps("release")).toBe(0);
    expect(countBuildSteps("all")).toBe(0);
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
