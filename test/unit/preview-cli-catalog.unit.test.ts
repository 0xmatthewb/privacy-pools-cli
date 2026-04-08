import { describe, expect, test } from "bun:test";
import {
  FLOW_STATUS_PREVIEW_PHASES,
  PREVIEW_CASES,
  PREVIEW_EXECUTION_KINDS,
  PREVIEW_MODES,
  PREVIEW_OWNERS,
  PREVIEW_RUNTIMES,
  PREVIEW_SOURCES,
  findPreviewCase,
} from "../../scripts/lib/preview-cli-catalog.mjs";
import { GENERATED_COMMAND_PATHS } from "../../src/utils/command-manifest.ts";

describe("preview cli catalog", () => {
  test("declares the richer preview contract for every case", () => {
    const ids = PREVIEW_CASES.map((previewCase) => previewCase.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const previewCase of PREVIEW_CASES) {
      expect(previewCase.label.length).toBeGreaterThan(0);
      expect(previewCase.journey.length).toBeGreaterThan(0);
      expect(previewCase.surface.length).toBeGreaterThan(0);
      expect(PREVIEW_OWNERS).toContain(previewCase.owner);
      expect(PREVIEW_RUNTIMES).toContain(previewCase.runtime);
      expect(PREVIEW_SOURCES).toContain(previewCase.source);
      expect(PREVIEW_EXECUTION_KINDS).toContain(previewCase.executionKind);
      expect(Array.isArray(previewCase.modes)).toBe(true);
      expect(previewCase.modes.length).toBeGreaterThan(0);
      for (const mode of previewCase.modes) {
        expect(PREVIEW_MODES).toContain(mode);
      }
      expect(new Set(previewCase.modes).size).toBe(previewCase.modes.length);
      expect(Array.isArray(previewCase.covers)).toBe(true);
      expect(previewCase.covers.length).toBeGreaterThan(0);
      expect(Array.isArray(previewCase.requiredSetup)).toBe(true);
      expect(previewCase.requiredSetup.length).toBeGreaterThan(0);
      expect(Array.isArray(previewCase.expectedExitCodes)).toBe(true);
      expect(previewCase.expectedExitCodes.length).toBeGreaterThan(0);
      for (const exitCode of previewCase.expectedExitCodes) {
        expect(Number.isInteger(exitCode)).toBe(true);
      }

      const requiresSyntheticReason =
        previewCase.executionKind === "renderer-fixture"
        || previewCase.requiredSetup.includes("preview-scenario");
      if (requiresSyntheticReason) {
        expect(typeof previewCase.syntheticReason).toBe("string");
        expect(previewCase.syntheticReason?.length).toBeGreaterThan(0);
      } else {
        expect(previewCase.syntheticReason).toBeUndefined();
      }
    }
  });

  test("covers the audited journeys and corrected ownership labels", () => {
    for (const caseId of [
      "welcome-banner",
      "root-help",
      "guide",
      "capabilities",
      "describe-withdraw-quote",
      "completion-bash",
      "init-configured-wallet",
      "init-generated",
      "init-imported",
      "init-overwrite-prompt",
      "js-activity-global",
      "native-activity-global",
      "js-activity-pool",
      "native-activity-pool",
      "activity-empty",
      "js-stats-global",
      "native-stats-global",
      "js-stats-pool",
      "native-stats-pool",
      "js-pools-list",
      "native-pools-list",
      "pools-empty",
      "pools-no-match",
      "forwarded-pool-detail",
      "forwarded-status-configured",
      "status-setup-required",
      "status-ready",
      "status-degraded",
      "accounts-empty",
      "accounts-pending-empty",
      "accounts-populated",
      "accounts-details",
      "accounts-summary",
      "accounts-verbose",
      "history-empty",
      "history-populated",
      "sync-empty",
      "sync-success",
      "migrate-status-no-legacy",
      "migrate-status-migration-required",
      "migrate-status-website-recovery",
      "migrate-status-review-incomplete",
      "migrate-status-fully-migrated",
      "deposit-dry-run",
      "deposit-success",
      "deposit-unsigned-envelope",
      "deposit-unsigned-tx",
      "deposit-validation",
      "withdraw-quote",
      "withdraw-quote-template",
      "withdraw-dry-run-relayed",
      "withdraw-success-relayed",
      "withdraw-dry-run-direct",
      "withdraw-success-direct",
      "withdraw-unsigned-envelope",
      "withdraw-unsigned-tx",
      "withdraw-validation",
      "ragequit-dry-run",
      "ragequit-success",
      "ragequit-unsigned-envelope",
      "ragequit-unsigned-tx",
      "ragequit-validation",
      "upgrade-check",
      "upgrade-manual-only",
      "upgrade-no-update",
      "upgrade-auto-available",
      "upgrade-ready",
      "upgrade-performed",
      "flow-start-validation",
      "flow-start-interactive-prompt",
      "flow-start-configured",
      "flow-start-new-wallet",
      "flow-start-watch",
      "flow-watch-awaiting-funding",
      "flow-watch-awaiting-asp",
      "flow-watch-waiting-privacy-delay",
      "flow-watch-ready",
      "flow-watch-withdrawing",
      "flow-watch-completed",
      "flow-watch-public-recovery",
      "flow-watch-declined",
      "flow-watch-poi-required",
      "flow-watch-relayer-minimum",
      "flow-watch-stopped-external",
      "flow-ragequit-success",
      "flow-ragequit-error",
    ]) {
      expect(findPreviewCase(caseId)).not.toBeNull();
    }

    expect(findPreviewCase("forwarded-pool-detail")).toMatchObject({
      owner: "forwarded",
      runtime: "forwarded",
      surface: "pools",
      source: "live-command",
      executionKind: "live-command",
    });

    expect(findPreviewCase("accounts-empty")).toMatchObject({
      owner: "forwarded",
      runtime: "forwarded",
      surface: "accounts",
      source: "live-command",
      executionKind: "live-command",
      syntheticReason: expect.any(String),
    });
  });

  test("includes help coverage for every generated command path", () => {
    const helpCaseIds = PREVIEW_CASES
      .filter((previewCase) => previewCase.surface === "help")
      .map((previewCase) => previewCase.id)
      .sort();
    const expectedHelpCaseIds = GENERATED_COMMAND_PATHS
      .map((commandPath) => `help-${commandPath.replace(/\s+/g, "-")}`)
      .sort();

    expect(helpCaseIds).toEqual([
      ...expectedHelpCaseIds,
      "root-help",
    ].sort());

    for (const caseId of expectedHelpCaseIds) {
      expect(findPreviewCase(caseId)).toMatchObject({
        owner: "native",
        runtime: "native",
        source: "live-command",
        executionKind: "live-command",
        surface: "help",
      });
    }
  });

  test("includes flow status coverage for every supported phase", () => {
    const flowCases = PREVIEW_CASES
      .filter((previewCase) => previewCase.id.startsWith("flow-status-"))
      .map((previewCase) => previewCase.id.slice("flow-status-".length))
      .sort();

    expect(flowCases).toEqual([...FLOW_STATUS_PREVIEW_PHASES].sort());
  });

  test("marks interactive prompt cases as tty-only", () => {
    expect(findPreviewCase("init-overwrite-prompt")).toMatchObject({
      modes: ["tty"],
    });
    expect(findPreviewCase("flow-start-interactive-prompt")).toMatchObject({
      modes: ["tty"],
    });
  });

  test("allows expected non-zero exits for validation and error states", () => {
    expect(findPreviewCase("deposit-validation")).toMatchObject({
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("withdraw-validation")).toMatchObject({
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("ragequit-validation")).toMatchObject({
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("flow-start-validation")).toMatchObject({
      expectedExitCodes: [1],
    });
    expect(findPreviewCase("flow-ragequit-error")).toMatchObject({
      expectedExitCodes: [2],
    });
  });
});
