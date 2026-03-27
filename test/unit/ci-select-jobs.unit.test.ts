import { describe, expect, test } from "bun:test";
import { evaluateJobSelection } from "../../scripts/ci/lib.mjs";
import { jsonContractDocRelativePath } from "../../src/utils/json.ts";

const JSON_CONTRACT_DOC_RELATIVE_PATH = jsonContractDocRelativePath();

describe("ci job selection", () => {
  test("pull requests skip unrelated jobs", () => {
    const decision = evaluateJobSelection({
      job: "anvil-e2e-smoke",
      eventName: "pull_request",
      changedFiles: ["docs/reference.md"],
    });

    expect(decision.shouldRun).toBe(false);
    expect(decision.reason).toContain("No changes matched");
  });

  test("pull requests run relevant jobs", () => {
    const decision = evaluateJobSelection({
      job: "coverage-guard",
      eventName: "pull_request",
      changedFiles: ["src/commands/withdraw.ts"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("src/commands/withdraw.ts");
  });

  test("push events run the full matrix", () => {
    const decision = evaluateJobSelection({
      job: "linux-core",
      eventName: "push",
      changedFiles: ["docs/reference.md"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("push runs the full test matrix");
  });

  test("flake lane follows the same changed-path filtering on pull requests", () => {
    const decision = evaluateJobSelection({
      job: "flake-core",
      eventName: "pull_request",
      changedFiles: ["src/commands/withdraw.ts"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("src/commands/withdraw.ts");
  });

  test("anvil flake lane follows shared-anvil changed-path filtering on pull requests", () => {
    const decision = evaluateJobSelection({
      job: "flake-anvil",
      eventName: "pull_request",
      changedFiles: ["test/helpers/shared-anvil.ts"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("test/helpers/shared-anvil.ts");
  });

  test("npm-test follows the core changed-path filtering on pull requests", () => {
    const decision = evaluateJobSelection({
      job: "npm-test",
      eventName: "pull_request",
      changedFiles: ["src/commands/withdraw.ts"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("src/commands/withdraw.ts");
  });

  test("cross-platform runs for native packaging changes", () => {
    const decision = evaluateJobSelection({
      job: "cross-platform",
      eventName: "pull_request",
      changedFiles: ["native/shell/src/main.rs"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("native/shell/src/main.rs");
  });

  test("native-smoke runs for native packaging changes", () => {
    const decision = evaluateJobSelection({
      job: "native-smoke",
      eventName: "pull_request",
      changedFiles: ["native/shell/src/main.rs"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("native/shell/src/main.rs");
  });

  test("native-unit and native-coverage run for native shell changes", () => {
    const unitDecision = evaluateJobSelection({
      job: "native-unit",
      eventName: "pull_request",
      changedFiles: ["native/shell/src/routing.rs"],
    });
    expect(unitDecision.shouldRun).toBe(true);
    expect(unitDecision.reason).toContain("native/shell/src/routing.rs");

    const coverageDecision = evaluateJobSelection({
      job: "native-coverage",
      eventName: "pull_request",
      changedFiles: ["native/shell/src/root_argv.rs"],
    });
    expect(coverageDecision.shouldRun).toBe(true);
    expect(coverageDecision.reason).toContain("native/shell/src/root_argv.rs");
  });

  test("supported-native-smoke runs for native packaging changes", () => {
    const decision = evaluateJobSelection({
      job: "supported-native-smoke",
      eventName: "pull_request",
      changedFiles: ["native/shell/src/main.rs"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("native/shell/src/main.rs");
  });

  test("native lanes run when their helpers or verifier change", () => {
    const helperDecision = evaluateJobSelection({
      job: "native-smoke",
      eventName: "pull_request",
      changedFiles: ["test/helpers/workspace-snapshot.ts"],
    });
    expect(helperDecision.shouldRun).toBe(true);
    expect(helperDecision.reason).toContain("test/helpers/workspace-snapshot.ts");

    const verifierDecision = evaluateJobSelection({
      job: "cross-platform",
      eventName: "pull_request",
      changedFiles: ["scripts/verify-packed-native-package.mjs"],
    });
    expect(verifierDecision.shouldRun).toBe(true);
    expect(verifierDecision.reason).toContain(
      "scripts/verify-packed-native-package.mjs",
    );

    const installDecision = evaluateJobSelection({
      job: "supported-native-smoke",
      eventName: "pull_request",
      changedFiles: ["scripts/verify-release-install.mjs"],
    });
    expect(installDecision.shouldRun).toBe(true);
    expect(installDecision.reason).toContain(
      "scripts/verify-release-install.mjs",
    );

    const packDecision = evaluateJobSelection({
      job: "cross-platform",
      eventName: "pull_request",
      changedFiles: ["scripts/pack-native-tarball.mjs"],
    });
    expect(packDecision.shouldRun).toBe(true);
    expect(packDecision.reason).toContain("scripts/pack-native-tarball.mjs");

    const sharedInstallDecision = evaluateJobSelection({
      job: "native-smoke",
      eventName: "pull_request",
      changedFiles: ["scripts/lib/install-verification.mjs"],
    });
    expect(sharedInstallDecision.shouldRun).toBe(true);
    expect(sharedInstallDecision.reason).toContain(
      "scripts/lib/install-verification.mjs",
    );

    const fixtureDecision = evaluateJobSelection({
      job: "supported-native-smoke",
      eventName: "pull_request",
      changedFiles: ["scripts/release-install-asp-fixture.mjs"],
    });
    expect(fixtureDecision.shouldRun).toBe(true);
    expect(fixtureDecision.reason).toContain(
      "scripts/release-install-asp-fixture.mjs",
    );

    const coverageScriptDecision = evaluateJobSelection({
      job: "native-coverage",
      eventName: "pull_request",
      changedFiles: ["scripts/check-native-coverage.mjs"],
    });
    expect(coverageScriptDecision.shouldRun).toBe(true);
    expect(coverageScriptDecision.reason).toContain(
      "scripts/check-native-coverage.mjs",
    );
  });

  test("docs-only changes do not fan out to expensive native matrices", () => {
    const nativeSmokeDecision = evaluateJobSelection({
      job: "native-smoke",
      eventName: "pull_request",
      changedFiles: ["AGENTS.md"],
    });
    expect(nativeSmokeDecision.shouldRun).toBe(false);
    expect(nativeSmokeDecision.reason).toContain("No changes matched");

    const supportedNativeDecision = evaluateJobSelection({
      job: "supported-native-smoke",
      eventName: "pull_request",
      changedFiles: ["docs/reference.md"],
    });
    expect(supportedNativeDecision.shouldRun).toBe(false);
    expect(supportedNativeDecision.reason).toContain("No changes matched");

    const crossPlatformDecision = evaluateJobSelection({
      job: "cross-platform",
      eventName: "pull_request",
      changedFiles: ["skills/privacy-pools-cli/reference.md"],
    });
    expect(crossPlatformDecision.shouldRun).toBe(false);
    expect(crossPlatformDecision.reason).toContain("No changes matched");
  });

  test("anvil smoke runs when installed-cli anvil verification changes", () => {
    const decision = evaluateJobSelection({
      job: "anvil-e2e-smoke",
      eventName: "pull_request",
      changedFiles: ["scripts/verify-cli-install-anvil.mjs"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("scripts/verify-cli-install-anvil.mjs");
  });

  test("packaged smoke runs when packaged smoke fixtures or helpers change", () => {
    const helperDecision = evaluateJobSelection({
      job: "packaged-smoke",
      eventName: "pull_request",
      changedFiles: ["test/helpers/cli.ts"],
    });
    expect(helperDecision.shouldRun).toBe(true);
    expect(helperDecision.reason).toContain("test/helpers/cli.ts");

    const suiteDecision = evaluateJobSelection({
      job: "packaged-smoke",
      eventName: "pull_request",
      changedFiles: ["test/integration/cli.packaged-smoke.integration.test.ts"],
    });
    expect(suiteDecision.shouldRun).toBe(true);
    expect(suiteDecision.reason).toContain(
      "test/integration/cli.packaged-smoke.integration.test.ts",
    );

    const runnerDecision = evaluateJobSelection({
      job: "packaged-smoke",
      eventName: "pull_request",
      changedFiles: ["scripts/run-bun-tests.mjs"],
    });
    expect(runnerDecision.shouldRun).toBe(true);
    expect(runnerDecision.reason).toContain("scripts/run-bun-tests.mjs");
  });

  test("native package smoke matrices run when the shared bun runner changes", () => {
    const nativeSmokeDecision = evaluateJobSelection({
      job: "native-smoke",
      eventName: "pull_request",
      changedFiles: ["scripts/run-bun-tests.mjs"],
    });
    expect(nativeSmokeDecision.shouldRun).toBe(true);
    expect(nativeSmokeDecision.reason).toContain("scripts/run-bun-tests.mjs");

    const supportedNativeDecision = evaluateJobSelection({
      job: "supported-native-smoke",
      eventName: "pull_request",
      changedFiles: ["scripts/run-bun-tests.mjs"],
    });
    expect(supportedNativeDecision.shouldRun).toBe(true);
    expect(supportedNativeDecision.reason).toContain("scripts/run-bun-tests.mjs");

    const crossPlatformDecision = evaluateJobSelection({
      job: "cross-platform",
      eventName: "pull_request",
      changedFiles: ["scripts/run-bun-tests.mjs"],
    });
    expect(crossPlatformDecision.shouldRun).toBe(true);
    expect(crossPlatformDecision.reason).toContain("scripts/run-bun-tests.mjs");
  });

  test("anvil lanes run when shared CLI helpers change", () => {
    const smokeDecision = evaluateJobSelection({
      job: "anvil-e2e-smoke",
      eventName: "pull_request",
      changedFiles: ["test/helpers/cli.ts"],
    });
    expect(smokeDecision.shouldRun).toBe(true);
    expect(smokeDecision.reason).toContain("test/helpers/cli.ts");

    const fullDecision = evaluateJobSelection({
      job: "full-anvil",
      eventName: "pull_request",
      changedFiles: ["test/helpers/cli.ts"],
    });
    expect(fullDecision.shouldRun).toBe(true);
    expect(fullDecision.reason).toContain("test/helpers/cli.ts");
  });

  test("packaged and native lanes run for shipped runtime contract docs", () => {
    const packagedDecision = evaluateJobSelection({
      job: "packaged-smoke",
      eventName: "pull_request",
      changedFiles: ["docs/runtime-upgrades.md"],
    });
    expect(packagedDecision.shouldRun).toBe(true);
    expect(packagedDecision.reason).toContain("docs/runtime-upgrades.md");

    const nativeDecision = evaluateJobSelection({
      job: "native-smoke",
      eventName: "pull_request",
      changedFiles: [JSON_CONTRACT_DOC_RELATIVE_PATH],
    });
    expect(nativeDecision.shouldRun).toBe(true);
    expect(nativeDecision.reason).toContain(JSON_CONTRACT_DOC_RELATIVE_PATH);
  });

  test("conformance-core runs when verification scripts change", () => {
    const decision = evaluateJobSelection({
      job: "conformance-core",
      eventName: "pull_request",
      changedFiles: ["scripts/verify-registry-install.mjs"],
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toContain("scripts/verify-registry-install.mjs");
  });
});
