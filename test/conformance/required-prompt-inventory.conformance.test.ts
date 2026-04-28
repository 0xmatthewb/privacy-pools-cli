import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREVIEW_PROMPT_INVENTORY,
  findPreviewCase,
} from "../../scripts/lib/preview-cli-catalog.mjs";
import {
  buildCommandDescriptor,
  listCommandPaths,
} from "../../src/utils/command-discovery-metadata.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

interface RequiredPromptInventoryRow {
  command: string;
  promptCaseIds?: string[];
  excludedReason?: string;
  sideEffectAssertions?: Array<{
    file: string;
    contains: string;
  }>;
}

const INVENTORY_PATH = join(CLI_ROOT, "test/fixtures/required-prompt-cases.json");
const INVENTORY = JSON.parse(
  readFileSync(INVENTORY_PATH, "utf8"),
) as RequiredPromptInventoryRow[];
const PROMPT_CASE_IDS = new Set(
  PREVIEW_PROMPT_INVENTORY.map((entry) => entry.caseId),
);

describe("required prompt inventory conformance", () => {
  test("catalog-declared human-review commands have explicit prompt coverage or an exclusion", () => {
    const expectedCommands = listCommandPaths()
      .filter((command) => buildCommandDescriptor(command).requiresHumanReview)
      .sort();
    const actualCommands = INVENTORY.map((row) => row.command).sort();

    expect(actualCommands).toEqual(expectedCommands);
  });

  for (const row of INVENTORY) {
    test(`${row.command} prompt inventory is reviewable`, () => {
      const hasPromptCases = (row.promptCaseIds?.length ?? 0) > 0;
      const hasExclusion = typeof row.excludedReason === "string";

      expect(hasPromptCases !== hasExclusion).toBe(true);
      if (hasExclusion) {
        expect(row.excludedReason!.trim().length).toBeGreaterThan(0);
        return;
      }

      for (const caseId of row.promptCaseIds ?? []) {
        expect(PROMPT_CASE_IDS.has(caseId), `${caseId} is not in PREVIEW_PROMPT_INVENTORY`).toBe(true);
        expect(findPreviewCase(caseId)).toMatchObject({
          commandPath: row.command,
          stateClass: "prompt",
        });
      }

      expect(row.sideEffectAssertions?.length ?? 0).toBeGreaterThan(0);
      for (const assertion of row.sideEffectAssertions ?? []) {
        const source = readFileSync(join(CLI_ROOT, assertion.file), "utf8");
        expect(source).toContain(assertion.contains);
      }
    });
  }
});
