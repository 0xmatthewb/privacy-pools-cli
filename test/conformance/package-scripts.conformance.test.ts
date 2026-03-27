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
  test("top-level test wrapper remains the shared suite runner", () => {
    expect(packageJson.scripts?.test).toBe("node scripts/run-test-suite.mjs");
  });

  test("conformance and release scripts route through the shared profile runner", () => {
    expect(packageJson.scripts?.["test:scripts"]).toBe(
      "node scripts/check-node-scripts.mjs",
    );
    expect(packageJson.scripts?.["test:install"]).toBe(
      "node scripts/run-test-profile.mjs install",
    );
    expect(packageJson.scripts?.["test:conformance"]).toBe(
      "node scripts/run-test-profile.mjs conformance",
    );
    expect(packageJson.scripts?.["test:conformance:all"]).toBe(
      "node scripts/run-test-profile.mjs conformance-all",
    );
    expect(packageJson.scripts?.["test:ci"]).toBe(
      "node scripts/run-test-profile.mjs ci",
    );
    expect(packageJson.scripts?.["test:release"]).toBe(
      "node scripts/run-test-profile.mjs release",
    );
    expect(packageJson.scripts?.["test:all"]).toBe(
      "node scripts/run-test-profile.mjs all",
    );
  });

  test("top-level test wrappers compose shared install and native lanes", () => {
    expect(packageJson.scripts?.["test:native:fmt"]).toBe(
      "cargo fmt --manifest-path native/shell/Cargo.toml --check",
    );
    expect(packageJson.scripts?.["test:native:lint"]).toBe(
      "cargo clippy --manifest-path native/shell/Cargo.toml --tests -- -D warnings",
    );
    expect(packageJson.scripts?.["test:native"]).toBe(
      "cargo test --manifest-path native/shell/Cargo.toml",
    );
    expect(packageJson.scripts?.["test:ci"]).toBe("node scripts/run-test-profile.mjs ci");
    expect(packageJson.scripts?.["test:release"]).toBe(
      "node scripts/run-test-profile.mjs release",
    );
    expect(packageJson.scripts?.["test:all"]).toBe(
      "node scripts/run-test-profile.mjs all",
    );
  });

  test("native package smoke scripts distinguish packaged smoke from installed-artifact checks", () => {
    expect(packageJson.scripts?.["test:smoke:native"]).toBe(
      "npm run test:smoke:native:package",
    );
    expect(packageJson.scripts?.["test:smoke:native:package"]).toBe(
      "node scripts/run-bun-tests.mjs ./test/integration/cli-native-package-smoke.integration.test.ts --timeout 240000",
    );
  });

  test("test:install mirrors the current-host installed-artifact gate", () => {
    expect(packageJson.scripts?.["test:artifacts:root"]).toBe(
      "node scripts/verify-root-only-host-artifact.mjs",
    );
    expect(packageJson.scripts?.["test:artifacts:host"]).toBe(
      "node scripts/verify-current-host-release-artifacts.mjs",
    );
    expect(packageJson.scripts?.["test:install"]).toBe(
      "node scripts/run-test-profile.mjs install",
    );
  });

  test("test:release includes the shared install gate and release benchmark gate", () => {
    expect(packageJson.scripts?.["bench:gate:release"]).toBe(
      "node scripts/bench-cli.mjs --base v1.7.0 --runtime native --runs 6 --warmup 1 --assert-thresholds scripts/bench-thresholds.json",
    );
    expect(packageJson.scripts?.["test:release"]).toBe(
      "node scripts/run-test-profile.mjs release",
    );
    expect(packageJson.scripts?.["test:all"]).toBe(
      "node scripts/run-test-profile.mjs all",
    );
  });

  test("native coverage script is published as a first-class repo contract", () => {
    expect(packageJson.scripts?.["test:coverage:native"]).toBe(
      "node scripts/check-native-coverage.mjs",
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
