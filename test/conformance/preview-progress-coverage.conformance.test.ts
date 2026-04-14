import { describe, expect, test } from "bun:test";
import {
  PREVIEW_COVERAGE_SPEC,
  PREVIEW_PROGRESS_ALLOWLIST,
  PREVIEW_PROGRESS_CALLSITE_PATTERNS,
  PREVIEW_PROGRESS_INVENTORY,
  findPreviewCase,
} from "../../scripts/lib/preview-cli-catalog.mjs";

function callsiteKey(file: string, pattern: string): string {
  return `${file}::${pattern.replace(/\s+/g, " ").trim()}`;
}

describe("preview progress catalog conformance", () => {
  test("re-exports one canonical progress inventory with unique steps and cases", () => {
    expect(PREVIEW_COVERAGE_SPEC.progressInventory).toEqual(
      PREVIEW_PROGRESS_INVENTORY,
    );

    const seenCaseIds = new Set<string>();
    const seenSteps = new Set<string>();

    for (const entry of PREVIEW_PROGRESS_INVENTORY) {
      expect(seenCaseIds.has(entry.caseId)).toBe(false);
      expect(seenSteps.has(entry.progressStep)).toBe(false);
      seenCaseIds.add(entry.caseId);
      seenSteps.add(entry.progressStep);

      const previewCase = findPreviewCase(entry.caseId);
      expect(previewCase).not.toBeNull();
      expect(previewCase?.stateClass).toBe("progress-step");
      expect(previewCase?.fidelity).toBe("progress-snapshot");
      expect(typeof previewCase?.commandPath).toBe("string");
      expect(
        previewCase?.commandPath === entry.commandPath
          || (
            typeof previewCase?.commandPath === "string"
            && previewCase.commandPath.startsWith(`${entry.commandPath} `)
          ),
      ).toBe(true);
    }
  });

  test("structured progress callsites are unique and point to declared step ids", () => {
    const declaredSteps = new Set(
      PREVIEW_PROGRESS_INVENTORY.map((entry) => entry.progressStep),
    );
    const seenCallsites = new Set<string>();

    for (const pattern of PREVIEW_PROGRESS_CALLSITE_PATTERNS) {
      expect(declaredSteps.has(pattern.progressStep)).toBe(true);

      const key = callsiteKey(pattern.file, pattern.pattern);
      expect(seenCallsites.has(key)).toBe(false);
      seenCallsites.add(key);
    }
  });

  test("allowlisted progress callsites are documented, unique, and separate from structured coverage", () => {
    const structuredCallsites = new Set(
      PREVIEW_PROGRESS_CALLSITE_PATTERNS.map((entry) =>
        callsiteKey(entry.file, entry.pattern)
      ),
    );
    const seenAllowlistEntries = new Set<string>();

    for (const entry of PREVIEW_PROGRESS_ALLOWLIST) {
      expect(entry.reason?.trim().length ?? 0).toBeGreaterThan(0);

      const key = callsiteKey(entry.file, entry.pattern);
      expect(seenAllowlistEntries.has(key)).toBe(false);
      expect(structuredCallsites.has(key)).toBe(false);
      seenAllowlistEntries.add(key);
    }
  });
});
