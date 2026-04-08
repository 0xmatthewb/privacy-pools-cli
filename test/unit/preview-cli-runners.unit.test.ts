import { describe, expect, test } from "bun:test";
import {
  createPreviewCoverageReport,
  formatPreviewCaseList,
  parsePreviewArgs,
  planPreviewMatrix,
  planPreviewSuite,
  resolvePreviewExecution,
  runCapturedPreviewSuite,
  runTtyPreviewSuite,
  shouldSkipTtyPreview,
} from "../../scripts/lib/preview-cli.mjs";

describe("preview cli runners", () => {
  test("parsePreviewArgs supports repeated --case and --list", () => {
    expect(
      parsePreviewArgs([
        "--case",
        "accounts-empty",
        "--case",
        "welcome-banner",
        "--journey",
        "flow",
        "--command",
        "withdraw",
        "--surface",
        "pools",
        "--variant",
        "ascii",
        "--list",
      ]),
    ).toEqual({
      caseIds: ["accounts-empty", "welcome-banner"],
      journeys: ["flow"],
      commands: ["withdraw"],
      surfaces: ["pools"],
      variants: ["ascii"],
      reportJson: false,
      smoke: false,
      listOnly: true,
    });
  });

  test("resolvePreviewExecution exposes the richer preview contract", () => {
    const forwardedPoolDetail = resolvePreviewExecution("forwarded-pool-detail");
    expect(forwardedPoolDetail.id).toBe("forwarded-pool-detail");
    expect(forwardedPoolDetail.surface).toBe("pools");
    expect(forwardedPoolDetail.runtime).toBe("forwarded");
    expect(forwardedPoolDetail.executionKind).toBe("live-command");
    expect(forwardedPoolDetail.execution.kind).toBe("live-command");
    expect(forwardedPoolDetail.execution.runtime).toBe("forwarded");
    expect(forwardedPoolDetail.execution.commandLabel).toBe(
      "privacy-pools --no-banner --chain sepolia pools ETH",
    );
    expect(forwardedPoolDetail.execution.needsFixtureServer).toBe(true);

    const accountsEmpty = resolvePreviewExecution("accounts-empty");
    expect(accountsEmpty.id).toBe("accounts-empty");
    expect(accountsEmpty.surface).toBe("accounts");
    expect(accountsEmpty.executionKind).toBe("live-command");
    expect(accountsEmpty.runtime).toBe("forwarded");
    expect(String(accountsEmpty.syntheticReason).length).toBeGreaterThan(0);
    expect(accountsEmpty.requiredSetup).toContain("preview-scenario");
    expect(accountsEmpty.execution.kind).toBe("live-command");
    expect(accountsEmpty.execution.runtime).toBe("forwarded");
    expect(accountsEmpty.execution.commandLabel).toBe(
      "privacy-pools --no-banner --chain sepolia accounts",
    );
    expect(accountsEmpty.execution.needsFixtureServer).toBe(false);
    expect(typeof accountsEmpty.execution.buildInvocation).toBe("function");
    expect(accountsEmpty.execution.ttyScript).toBeUndefined();
    expect(accountsEmpty.execution.requiresTtyScript).toBe(false);

    const initOverwritePrompt = resolvePreviewExecution("init-overwrite-prompt");
    expect(initOverwritePrompt.modes).toEqual(["tty"]);
    expect(initOverwritePrompt.execution.requiresTtyScript).toBe(true);
    expect(initOverwritePrompt.execution.ttyScript).toMatchObject({
      steps: [{ waitFor: "Continue?", send: "n\r" }],
    });

    expect(planPreviewSuite(["welcome-banner", "accounts-empty"]).map((plan) => plan.id)).toEqual([
      "welcome-banner",
      "accounts-empty",
    ]);
  });

  test("preview planning expands cases across variants", () => {
    const plans = planPreviewMatrix({
      caseIds: ["welcome-banner"],
      variants: ["rich", "ascii"],
    });

    expect(plans.map((plan) => plan.id)).toEqual([
      "welcome-banner::rich",
      "welcome-banner::ascii",
    ]);
    expect(plans.map((plan) => plan.variantId)).toEqual(["rich", "ascii"]);
  });

  test("captured preview supports dry-run planning without executing commands", async () => {
    const result = await runCapturedPreviewSuite({
      caseIds: ["js-activity-global", "accounts-empty"],
      variants: ["rich"],
      dryRun: true,
    });

    expect(result).toMatchObject({
      dryRun: true,
      requiresFixtureServer: true,
    });
    expect(result.plans.map((plan) => plan.id)).toEqual([
      "js-activity-global::rich",
      "accounts-empty::rich",
    ]);
  });

  test("captured preview skips tty-only cases in dry-run planning", async () => {
    const result = await runCapturedPreviewSuite({
      caseIds: ["init-overwrite-prompt", "flow-start-interactive-prompt"],
      variants: ["rich"],
      dryRun: true,
    });

    expect(result).toMatchObject({
      dryRun: true,
      requiresFixtureServer: false,
    });
    expect(result.plans).toEqual([]);
  });

  test("tty preview skips cleanly without an interactive terminal", async () => {
    const writes = [];
    const result = await runTtyPreviewSuite({
      io: {
        stdin: { isTTY: false },
        stdout: { isTTY: false },
      },
      writeOut: (value) => {
        writes.push(value);
      },
    });

    expect(
      shouldSkipTtyPreview({
        stdin: { isTTY: false },
        stdout: { isTTY: false },
      }),
    ).toBe(true);
    expect(result).toMatchObject({
      skipped: true,
      failures: [],
    });
    expect(writes.join("")).toContain("Skipping TTY preview");
  });

  test("tty preview supports dry-run planning when a tty is available", async () => {
    const result = await runTtyPreviewSuite({
      dryRun: true,
      caseIds: ["native-activity-global", "flow-status-completed"],
      variants: ["rich"],
      io: {
        stdin: { isTTY: true },
        stdout: { isTTY: true },
      },
    });

    expect(result).toMatchObject({
      dryRun: true,
    });
    expect(result.plans.map((plan) => plan.id)).toEqual([
      "native-activity-global::rich",
      "flow-status-completed::rich",
    ]);
  });

  test("tty preview keeps interactive-only prompt cases in dry-run planning", async () => {
    const result = await runTtyPreviewSuite({
      dryRun: true,
      caseIds: ["init-overwrite-prompt", "flow-start-interactive-prompt"],
      variants: ["rich"],
      io: {
        stdin: { isTTY: true },
        stdout: { isTTY: true },
      },
    });

    expect(result.plans.map((plan) => plan.id)).toEqual([
      "init-overwrite-prompt::rich",
      "flow-start-interactive-prompt::rich",
    ]);
  });

  test("formatPreviewCaseList surfaces the richer contract columns", () => {
    const output = formatPreviewCaseList({
      caseIds: ["forwarded-pool-detail", "accounts-empty"],
    });

    expect(output).toContain("id | command | stateId | stateClass | journey | surface");
    expect(output).toContain("forwarded-pool-detail");
    expect(output).toContain("forwarded");
    expect(output).toContain("live-command");
    expect(output).toContain("preview-scenario");
    expect(output).toContain("captured, tty");
    expect(output).toContain("synthetic");
  });

  test("coverage report summarizes rendered and missing states", () => {
    const report = createPreviewCoverageReport({
      capturedResult: {
        plans: planPreviewMatrix({
          caseIds: ["welcome-banner", "accounts-empty"],
          variants: ["rich"],
        }),
        executions: [
          {
            planId: "welcome-banner::rich",
            status: "rendered",
          },
        ],
      },
    });

    expect(report.summary.expectedPlans).toBe(2);
    expect(report.summary.renderedPlans).toBe(1);
    expect(report.summary.missingStates).toBe(1);
  });
});
