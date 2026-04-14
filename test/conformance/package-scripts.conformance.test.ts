import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

const packageJson = JSON.parse(
  readFileSync(join(CLI_ROOT, "package.json"), "utf8"),
) as {
  files?: string[];
  scripts?: Record<string, string>;
  version?: string;
};

function getScript(name: string): string {
  const script = packageJson.scripts?.[name];
  expect(typeof script).toBe("string");
  return script!;
}

function expectScriptContains(name: string, fragments: string[]): void {
  const script = getScript(name);
  for (const fragment of fragments) {
    expect(script).toContain(fragment);
  }
}

describe("package scripts conformance", () => {
  test("top-level test wrapper remains the shared suite runner", () => {
    expect(getScript("test")).toBe("node scripts/run-test-suite.mjs");
  });

  test("published package includes bundled circuit artifacts", () => {
    expect(packageJson.files).toContain("assets");
  });

  test("runtime-facing scripts use node plus tsx rather than bun", () => {
    expect(getScript("cli")).toBe("node --import tsx src/index.ts");
    expect(getScript("dev")).toBe("node --import tsx src/index.ts");
    expectScriptContains("discovery:generate", [
      "npm run build",
      "node scripts/generate-command-discovery-static.mjs",
    ]);
    expectScriptContains("docs:generate", [
      "npm run build",
      "node scripts/generate-reference.mjs --write",
    ]);
    expectScriptContains("docs:preview", [
      "npm run build",
      "node scripts/generate-reference.mjs",
    ]);
    expectScriptContains("docs:check", [
      "npm run build",
      "node scripts/generate-reference.mjs --check",
    ]);
  });

  test("conformance and release scripts route through the shared profile runner", () => {
    expect(packageJson.scripts?.["circuits:provision"]).toBeUndefined();
    expect(packageJson.scripts?.["circuits:refresh"]).toBeUndefined();
    expect(packageJson.scripts?.["test:scripts"]).toBe(
      "node scripts/check-node-scripts.mjs",
    );
    for (const [scriptName, profileName] of [
      ["test:conformance", "conformance"],
      ["test:conformance:all", "conformance-all"],
      ["test:ci", "ci"],
      ["test:release", "release"],
      ["test:all", "all"],
    ] as const) {
      expectScriptContains(scriptName, [
        "node scripts/run-test-profile.mjs",
        profileName,
      ]);
    }
  });

  test("native smoke scripts publish both packaged and launcher-parity lanes", () => {
    expect(getScript("test:smoke:native")).toBe("npm run test:smoke:native:package");
    expect(getScript("test:smoke")).toBe("npm run test:packed-smoke");
    expectScriptContains("test:packed-smoke", [
      "node scripts/run-bun-tests.mjs",
      "./test/integration/cli-packaged-smoke.integration.test.ts",
    ]);
    expectScriptContains("test:smoke:native:shell", [
      "./test/integration/cli-native-machine-contract.integration.test.ts",
      "./test/integration/cli-native-routing-smoke.integration.test.ts",
      "./test/integration/cli-native-human-output.integration.test.ts",
    ]);
    expectScriptContains("test:smoke:native:package", [
      "node scripts/run-bun-tests.mjs",
      "./test/integration/cli-native-package-smoke.integration.test.ts",
    ]);
    expectScriptContains("test:fuzz", [
      "node scripts/run-bun-tests.mjs",
      "./test/fuzz",
    ]);
    expectScriptContains("test:evals", [
      "node scripts/run-bun-tests.mjs",
      "./test/evals",
    ]);
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

  test("native coverage script is published as a first-class repo contract", () => {
    expect(packageJson.scripts?.["test:coverage:native"]).toBe(
      "node scripts/check-native-coverage.mjs",
    );
  });

  test("native validation scripts stay published as top-level repo contracts", () => {
    expect(packageJson.scripts?.["test:native:fmt"]).toBe(
      "cargo fmt --manifest-path native/shell/Cargo.toml --check",
    );
    expect(packageJson.scripts?.["test:native:lint"]).toBe(
      "cargo clippy --manifest-path native/shell/Cargo.toml --tests -- -D warnings",
    );
    expect(packageJson.scripts?.["test:native"]).toBe(
      "cargo test --manifest-path native/shell/Cargo.toml",
    );
    expectScriptContains("bench:gate:release", [
      "node scripts/bench-cli.mjs",
      `--base v${packageJson.version}`,
      "--runtime native",
      "--runs 6",
      "--warmup 1",
      "--assert-thresholds scripts/bench-thresholds.json",
    ]);
    expectScriptContains("bench:gate:readonly", [
      "node scripts/bench-cli.mjs",
      "--base self",
      "--matrix readonly",
      "--runtime launcher-binary-override",
      "--runs 6",
      "--warmup 1",
      "--assert-thresholds scripts/bench-thresholds.json",
    ]);
    expect(packageJson.scripts?.["test:stress"]).toBe("node scripts/run-stress.mjs");
  });

  test("package-lock is the only published lockfile", () => {
    expect(existsSync(join(CLI_ROOT, "package-lock.json"))).toBe(true);
    expect(existsSync(join(CLI_ROOT, "bun.lock"))).toBe(false);
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
