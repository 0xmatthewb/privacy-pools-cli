import { describe, expect, test } from "bun:test";
import {
  PREVIEW_COVERAGE_SPEC,
  FLOW_STATUS_PREVIEW_PHASES,
  PREVIEW_CASES,
  PREVIEW_EXECUTION_KINDS,
  PREVIEW_FIDELITIES,
  PREVIEW_MODES,
  PREVIEW_OWNERS,
  PREVIEW_PROGRESS_INVENTORY,
  PREVIEW_PROMPT_INVENTORY,
  PREVIEW_RUNTIMES,
  PREVIEW_SOURCES,
  PREVIEW_STATE_CLASSES,
  PREVIEW_VARIANT_IDS,
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
      expect(typeof previewCase.commandPath).toBe("string");
      expect(previewCase.commandPath.length).toBeGreaterThan(0);
      expect(typeof previewCase.stateId).toBe("string");
      expect(previewCase.stateId.length).toBeGreaterThan(0);
      expect(PREVIEW_STATE_CLASSES).toContain(previewCase.stateClass);
      expect(PREVIEW_FIDELITIES).toContain(previewCase.fidelity);
      expect(typeof previewCase.interactive).toBe("boolean");
      expect(typeof previewCase.runtimeTarget).toBe("string");
      expect(Array.isArray(previewCase.variantPolicy)).toBe(true);
      expect(previewCase.variantPolicy.length).toBeGreaterThan(0);
      for (const variantId of previewCase.variantPolicy) {
        expect(PREVIEW_VARIANT_IDS).toContain(variantId);
      }
      for (const exitCode of previewCase.expectedExitCodes) {
        expect(Number.isInteger(exitCode)).toBe(true);
      }

      const requiresSyntheticReason =
        previewCase.executionKind === "renderer-fixture"
        || previewCase.requiredSetup.includes("preview-scenario")
        || previewCase.fidelity === "progress-snapshot";
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
      "init-setup-mode-prompt",
      "init-import-recovery-prompt",
      "init-backup-method-prompt",
      "init-backup-path-prompt",
      "init-backup-confirm-prompt",
      "init-signer-key-prompt",
      "init-default-chain-prompt",
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
      "native-pools-no-match",
      "native-pool-detail",
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
      "deposit-asset-select-prompt",
      "deposit-unique-amount-prompt",
      "deposit-confirm-prompt",
      "deposit-progress-approve-token",
      "deposit-progress-submit",
      "withdraw-quote",
      "withdraw-quote-template",
      "withdraw-dry-run-relayed",
      "withdraw-success-relayed",
      "withdraw-dry-run-direct",
      "withdraw-success-direct",
      "withdraw-unsigned-envelope",
      "withdraw-unsigned-tx",
      "withdraw-validation",
      "withdraw-pa-select-prompt",
      "withdraw-recipient-prompt",
      "withdraw-direct-confirm-prompt",
      "withdraw-confirm",
      "withdraw-progress-request-quote",
      "withdraw-progress-generate-proof",
      "withdraw-progress-submit-direct",
      "withdraw-progress-submit-relayed",
      "ragequit-dry-run",
      "ragequit-success",
      "ragequit-unsigned-envelope",
      "ragequit-unsigned-tx",
      "ragequit-validation",
      "ragequit-select",
      "ragequit-confirm",
      "ragequit-progress-load-account",
      "ragequit-progress-generate-proof",
      "ragequit-progress-submit",
      "upgrade-check",
      "upgrade-manual-only",
      "upgrade-no-update",
      "upgrade-auto-available",
      "upgrade-ready",
      "upgrade-performed",
      "upgrade-confirm-prompt",
      "upgrade-progress-check",
      "upgrade-progress-install",
      "flow-start-validation",
      "flow-start-interactive-prompt",
      "flow-start-confirm-prompt",
      "flow-start-configured",
      "flow-start-new-wallet",
      "flow-start-new-wallet-backup-choice",
      "flow-start-new-wallet-backup-path-prompt",
      "flow-start-new-wallet-backup-confirm",
      "flow-start-watch",
      "flow-start-progress-submit-deposit",
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
    for (const prompt of PREVIEW_PROMPT_INVENTORY) {
      expect(findPreviewCase(prompt.caseId)).toMatchObject({
        modes: ["tty"],
        stateClass: "prompt",
      });
    }
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
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("flow-ragequit-error")).toMatchObject({
      expectedExitCodes: [2],
    });
  });

  test("requires tty scripts for prompt cases that must drive earlier input", () => {
    for (const prompt of PREVIEW_PROMPT_INVENTORY) {
      const previewCase = findPreviewCase(prompt.caseId);
      expect(previewCase?.preview?.requiresTtyScript).toBe(true);
      expect(previewCase?.preview?.ttyScript).toBeDefined();
    }
  });

  test("declares prompt and progress coverage inventories explicitly", () => {
    expect(PREVIEW_COVERAGE_SPEC.commandInventory).toContain("root");
    expect(PREVIEW_COVERAGE_SPEC.commandInventory).toEqual([
      "root",
      ...GENERATED_COMMAND_PATHS,
    ]);
    expect(PREVIEW_COVERAGE_SPEC.promptInventory).toEqual(PREVIEW_PROMPT_INVENTORY);
    expect(PREVIEW_COVERAGE_SPEC.progressInventory).toEqual(PREVIEW_PROGRESS_INVENTORY);

    for (const progress of PREVIEW_PROGRESS_INVENTORY) {
      expect(findPreviewCase(progress.caseId)).toMatchObject({
        stateClass: "progress-step",
        fidelity: "progress-snapshot",
      });
    }
  });

  test("tracks native-route audit obligations for hybrid and native commands", () => {
    expect(
      PREVIEW_COVERAGE_SPEC.nativeRouteInventory.some(
        (entry) => entry.commandPath === "pools",
      ),
    ).toBe(true);
    expect(findPreviewCase("native-pools-list")).not.toBeNull();
    expect(findPreviewCase("native-pools-no-match")).not.toBeNull();
    expect(findPreviewCase("native-pool-detail")).not.toBeNull();
  });
});
