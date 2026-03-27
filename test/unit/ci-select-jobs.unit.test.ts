import { describe, expect, test } from "bun:test";
import { evaluateJobSelection } from "../../scripts/ci/lib.mjs";

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
      changedFiles: ["docs/contracts/cli-json-contract.v1.5.0.json"],
    });
    expect(nativeDecision.shouldRun).toBe(true);
    expect(nativeDecision.reason).toContain(
      "docs/contracts/cli-json-contract.v1.5.0.json",
    );
  });
});
