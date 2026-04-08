import { describe, expect, test } from "bun:test";
import {
  formatPreviewCaseList,
  parsePreviewArgs,
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
        "--list",
      ]),
    ).toEqual({
      caseIds: ["accounts-empty", "welcome-banner"],
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

    const initOverwritePrompt = resolvePreviewExecution("init-overwrite-prompt");
    expect(initOverwritePrompt.modes).toEqual(["tty"]);
    expect(initOverwritePrompt.execution.ttyScript).toMatchObject({
      steps: [{ waitFor: "Continue?", send: "n\r" }],
    });

    expect(planPreviewSuite(["welcome-banner", "accounts-empty"]).map((plan) => plan.id)).toEqual([
      "welcome-banner",
      "accounts-empty",
    ]);
  });

  test("captured preview supports dry-run planning without executing commands", async () => {
    const result = await runCapturedPreviewSuite({
      caseIds: ["js-activity-global", "accounts-empty"],
      dryRun: true,
    });

    expect(result).toMatchObject({
      dryRun: true,
      requiresFixtureServer: true,
    });
    expect(result.plans.map((plan) => plan.id)).toEqual([
      "js-activity-global",
      "accounts-empty",
    ]);
  });

  test("captured preview skips tty-only cases in dry-run planning", async () => {
    const result = await runCapturedPreviewSuite({
      caseIds: ["init-overwrite-prompt", "flow-start-interactive-prompt"],
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
      io: {
        stdin: { isTTY: true },
        stdout: { isTTY: true },
      },
    });

    expect(result).toMatchObject({
      dryRun: true,
    });
    expect(result.plans.map((plan) => plan.id)).toEqual([
      "native-activity-global",
      "flow-status-completed",
    ]);
  });

  test("tty preview keeps interactive-only prompt cases in dry-run planning", async () => {
    const result = await runTtyPreviewSuite({
      dryRun: true,
      caseIds: ["init-overwrite-prompt", "flow-start-interactive-prompt"],
      io: {
        stdin: { isTTY: true },
        stdout: { isTTY: true },
      },
    });

    expect(result.plans.map((plan) => plan.id)).toEqual([
      "init-overwrite-prompt",
      "flow-start-interactive-prompt",
    ]);
  });

  test("formatPreviewCaseList surfaces the richer contract columns", () => {
    const output = formatPreviewCaseList([
      "forwarded-pool-detail",
      "accounts-empty",
    ]);

    expect(output).toContain("id | journey | surface | owner | runtime | execution");
    expect(output).toContain("forwarded-pool-detail");
    expect(output).toContain("forwarded");
    expect(output).toContain("live-command");
    expect(output).toContain("preview-scenario");
    expect(output).toContain("captured, tty");
    expect(output).toContain("synthetic");
  });
});
