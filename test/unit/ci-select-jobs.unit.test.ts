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
});
