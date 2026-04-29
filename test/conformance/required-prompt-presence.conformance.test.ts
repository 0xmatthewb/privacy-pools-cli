import { describe, expect, test } from "bun:test";
import {
  buildCommandDescriptor,
  listCommandPaths,
} from "../../src/utils/command-discovery-metadata.ts";
import { COMMAND_CATALOG } from "../../src/utils/command-catalog.ts";
import {
  requiredPromptHarnessCommands,
  runWithRequiredPromptHarness,
} from "../helpers/required-prompt-harness.ts";

describe("required prompt presence conformance", () => {
  test("catalog-declared human-review commands have prompt harness coverage or an exclusion", () => {
    const expectedCommands = listCommandPaths()
      .filter((command) => buildCommandDescriptor(command).requiresHumanReview)
      .sort();
    const harnessed = new Set(requiredPromptHarnessCommands());

    for (const command of expectedCommands) {
      const metadata = COMMAND_CATALOG[command];
      const hasHarness = harnessed.has(command);
      const hasExclusion =
        typeof metadata.requiredPromptExcludedReason === "string" &&
        metadata.requiredPromptExcludedReason.trim().length > 0;

      expect(
        hasHarness !== hasExclusion,
        `${command} must have exactly one prompt harness or exclusion reason`,
      ).toBe(true);
    }
  });

  for (const command of requiredPromptHarnessCommands()) {
    test(`${command} prompts before local writes`, async () => {
      const result = await runWithRequiredPromptHarness(command);
      expect(result.promptShown, `${command} output:\n${result.stderr}\n${result.stdout}`).toBe(
        true,
      );
      expect(result.chainCalls).toBe(0);
      expect(result.fileWrites).toEqual([]);
    }, 30_000);
  }
});
