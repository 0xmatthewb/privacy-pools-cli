import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

const packageJson = JSON.parse(
  readFileSync(join(CLI_ROOT, "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};

describe("package scripts conformance", () => {
  test("native package smoke scripts distinguish packaged smoke from installed-artifact checks", () => {
    expect(packageJson.scripts?.["test:smoke:native"]).toBe(
      "npm run test:smoke:native:package",
    );
    expect(packageJson.scripts?.["test:smoke:native:package"]).toBe(
      "node scripts/run-bun-tests.mjs ./test/integration/cli-native-package-smoke.integration.test.ts --timeout 240000",
    );
    expect(packageJson.scripts?.["test:ci"]).toContain(
      "npm run test:smoke:native:package",
    );
    expect(packageJson.scripts?.["test:release"]).toContain(
      "npm run test:smoke:native:package",
    );
    expect(packageJson.scripts?.["test:all"]).toContain(
      "npm run test:smoke:native:package",
    );
  });

  test("test:ci mirrors the current-host installed-artifact gate", () => {
    expect(packageJson.scripts?.["test:artifacts:host"]).toBe(
      "node scripts/verify-current-host-release-artifacts.mjs",
    );
    expect(packageJson.scripts?.["test:ci"]).toContain("npm run test:artifacts:host");
  });

  test("test:release includes the current-host artifact gate and release benchmark gate", () => {
    expect(packageJson.scripts?.["bench:gate:release"]).toBe(
      "node scripts/bench-cli.mjs --base v1.7.0 --runtime native --runs 6 --warmup 1 --assert-thresholds scripts/bench-thresholds.json",
    );
    expect(packageJson.scripts?.["test:release"]).toContain(
      "npm run test:artifacts:host",
    );
    expect(packageJson.scripts?.["test:release"]).toContain(
      "npm run bench:gate:release",
    );
    expect(packageJson.scripts?.["test:all"]).toContain(
      "npm run bench:gate:release",
    );
  });

  test("test:flake covers packaged js, packaged native, and installed-artifact lanes", () => {
    expect(packageJson.scripts?.["test:flake"]).toBe(
      "node scripts/run-flake-suite.mjs",
    );
    expect(packageJson.scripts?.["test:flake:anvil"]).toBe(
      "node scripts/run-anvil-flake-suite.mjs",
    );
  });
});
