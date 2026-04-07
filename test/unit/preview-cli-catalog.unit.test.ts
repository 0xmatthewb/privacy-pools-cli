import { describe, expect, test } from "bun:test";
import {
  FLOW_STATUS_PREVIEW_PHASES,
  PREVIEW_CASES,
  PREVIEW_OWNERS,
  PREVIEW_SOURCES,
  findPreviewCase,
} from "../../scripts/lib/preview-cli-catalog.mjs";

describe("preview cli catalog", () => {
  test("uses unique ids and valid metadata enums", () => {
    const ids = PREVIEW_CASES.map((previewCase) => previewCase.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const previewCase of PREVIEW_CASES) {
      expect(previewCase.label.length).toBeGreaterThan(0);
      expect(previewCase.journey.length).toBeGreaterThan(0);
      expect(PREVIEW_OWNERS).toContain(previewCase.owner);
      expect(PREVIEW_SOURCES).toContain(previewCase.source);
      expect(previewCase.requiredSetup.length).toBeGreaterThan(0);
    }
  });

  test("covers the audited journeys and corrected ownership labels", () => {
    for (const caseId of [
      "welcome-banner",
      "root-help",
      "guide",
      "init-configured-wallet",
      "js-activity-global",
      "native-activity-global",
      "js-stats-global",
      "native-stats-global",
      "js-pools-list",
      "native-pools-list",
      "forwarded-pool-detail",
      "forwarded-status-configured",
      "accounts-empty",
      "accounts-pending-empty",
      "accounts-populated",
      "deposit-dry-run",
      "deposit-success",
      "withdraw-quote",
      "withdraw-dry-run-relayed",
      "withdraw-success-relayed",
      "withdraw-dry-run-direct",
      "withdraw-success-direct",
      "ragequit-dry-run",
      "ragequit-success",
      "upgrade-check",
    ]) {
      expect(findPreviewCase(caseId)).not.toBeNull();
    }

    expect(findPreviewCase("forwarded-pool-detail")).toMatchObject({
      owner: "forwarded",
      source: "live-command",
    });
  });

  test("includes flow status coverage for every supported phase", () => {
    const flowCases = PREVIEW_CASES
      .filter((previewCase) => previewCase.id.startsWith("flow-status-"))
      .map((previewCase) => previewCase.id.slice("flow-status-".length))
      .sort();

    expect(flowCases).toEqual([...FLOW_STATUS_PREVIEW_PHASES].sort());
  });
});
