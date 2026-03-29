import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

const packageJson = JSON.parse(
  readFileSync(join(CLI_ROOT, "package.json"), "utf8"),
) as {
  files?: string[];
  scripts?: Record<string, string>;
};
const stressRunnerSource = readFileSync(
  join(CLI_ROOT, "scripts", "run-stress.mjs"),
  "utf8",
);
const testSuiteRunnerSource = readFileSync(
  join(CLI_ROOT, "scripts", "run-test-suite.mjs"),
  "utf8",
);
const flakeRunnerSource = readFileSync(
  join(CLI_ROOT, "scripts", "run-flake-suite.mjs"),
  "utf8",
);
const anvilRunnerSource = readFileSync(
  join(CLI_ROOT, "scripts", "run-anvil-tests.mjs"),
  "utf8",
);
const anvilSmokeRunnerSource = readFileSync(
  join(CLI_ROOT, "scripts", "run-anvil-smoke.mjs"),
  "utf8",
);
const conformanceRunnerSource = readFileSync(
  join(CLI_ROOT, "scripts", "run-conformance-suite.mjs"),
  "utf8",
);
const coverageRunnerSource = readFileSync(
  join(CLI_ROOT, "scripts", "check-coverage.mjs"),
  "utf8",
);

describe("package scripts conformance", () => {
  test("top-level test wrapper remains the shared suite runner", () => {
    expect(packageJson.scripts?.test).toBe("node scripts/run-test-suite.mjs");
  });

  test("published package includes bundled circuit artifacts", () => {
    expect(packageJson.files).toContain("assets");
  });

  test("runtime-facing scripts use node plus tsx rather than bun", () => {
    expect(packageJson.scripts?.cli).toBe("node --import tsx src/index.ts");
    expect(packageJson.scripts?.dev).toBe("node --import tsx src/index.ts");
    expect(packageJson.scripts?.["discovery:generate"]).toBe(
      "npm run build && node scripts/generate-command-discovery-static.mjs",
    );
    expect(packageJson.scripts?.["docs:generate"]).toBe(
      "npm run build && node scripts/generate-reference.mjs --write",
    );
    expect(packageJson.scripts?.["docs:preview"]).toBe(
      "npm run build && node scripts/generate-reference.mjs",
    );
    expect(packageJson.scripts?.["docs:check"]).toBe(
      "npm run build && node scripts/generate-reference.mjs --check",
    );
  });

  test("conformance and release scripts route through the shared profile runner", () => {
    expect(packageJson.scripts?.["circuits:provision"]).toBe(
      "node scripts/provision-circuits.mjs",
    );
    expect(packageJson.scripts?.["circuits:refresh"]).toBe(
      "node scripts/refresh-bundled-circuits.mjs",
    );
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

  test("native smoke scripts publish both packaged and launcher-parity lanes", () => {
    expect(packageJson.scripts?.["test:smoke"]).toBe(
      "node scripts/run-bun-tests.mjs ./test/integration/cli.packaged-smoke.integration.test.ts --timeout 180000 --process-timeout-ms 600000",
    );
    expect(packageJson.scripts?.["test:smoke:native"]).toBe(
      "npm run test:smoke:native:package",
    );
    expect(packageJson.scripts?.["test:smoke:native:shell"]).toBe(
      "node scripts/run-bun-tests.mjs ./test/integration/cli-native-shell.integration.test.ts --timeout 300000 --process-timeout-ms 900000",
    );
    expect(packageJson.scripts?.["test:smoke:native:package"]).toBe(
      "node scripts/run-bun-tests.mjs ./test/integration/cli-native-package-smoke.integration.test.ts --timeout 240000 --process-timeout-ms 900000",
    );
    expect(packageJson.scripts?.["test:fuzz"]).toBe(
      "node scripts/run-bun-tests.mjs ./test/fuzz --timeout 120000 --process-timeout-ms 600000",
    );
    expect(packageJson.scripts?.["test:evals"]).toBe(
      "node scripts/run-bun-tests.mjs ./test/evals --timeout 120000 --process-timeout-ms 600000",
    );
  });

  test("stress lane uses the bounded Bun wrapper instead of spawning Bun directly", () => {
    expect(packageJson.scripts?.["test:stress"]).toBe("node scripts/run-stress.mjs");
    expect(stressRunnerSource).toContain('resolve(ROOT, "scripts", "run-bun-tests.mjs")');
    expect(stressRunnerSource).toContain('"--process-timeout-ms"');
    expect(stressRunnerSource).not.toContain('spawnSync("bun"');
  });

  test("repo suite wrappers make Bun watchdog budgets explicit", () => {
    expect(testSuiteRunnerSource).toContain('"--process-timeout-ms"');
    expect(flakeRunnerSource).toContain('"--process-timeout-ms"');
    expect(anvilRunnerSource).toContain('"--process-timeout-ms"');
    expect(anvilSmokeRunnerSource).toContain('"--process-timeout-ms"');
    expect(conformanceRunnerSource).toContain('"--process-timeout-ms"');
    expect(coverageRunnerSource).toContain('"--process-timeout-ms"');
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
