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
    expect(parsePreviewArgs(["--case", "accounts-empty", "--case", "welcome-banner", "--list"])).toEqual({
      caseIds: ["accounts-empty", "welcome-banner"],
      listOnly: true,
    });
  });

  test("planPreviewSuite differentiates live and renderer fixture cases", () => {
    expect(resolvePreviewExecution("forwarded-pool-detail")).toMatchObject({
      id: "forwarded-pool-detail",
      execution: {
        kind: "live-command",
        runtime: "forwarded",
        needsFixtureServer: true,
      },
    });

    expect(resolvePreviewExecution("accounts-empty")).toMatchObject({
      id: "accounts-empty",
      execution: {
        kind: "renderer-fixture",
        fixtureCaseId: "accounts-empty",
      },
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

    expect(shouldSkipTtyPreview({
      stdin: { isTTY: false },
      stdout: { isTTY: false },
    })).toBe(true);
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

  test("formatPreviewCaseList surfaces owner and source metadata", () => {
    const output = formatPreviewCaseList(["forwarded-pool-detail"]);
    expect(output).toContain("forwarded-pool-detail");
    expect(output).toContain("forwarded");
    expect(output).toContain("live-command");
  });
});
