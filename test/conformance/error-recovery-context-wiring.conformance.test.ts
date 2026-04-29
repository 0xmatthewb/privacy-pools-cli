import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

describe("error recovery context wiring", () => {
  test("command handlers preserve chain context through central error normalization", () => {
    const depositSource = source("../../src/commands/deposit.ts");
    expect(depositSource).toContain(
      "errorRecoveryContext = { chain: chainConfig.name };",
    );
    expect(depositSource).toContain(
      "normalizeInitRequiredInputError(error, errorRecoveryContext)",
    );

    const ragequitSource = source("../../src/commands/ragequit.ts");
    expect(ragequitSource).toContain(
      "errorRecoveryContext = { chain: chainConfig.name };",
    );
    expect(ragequitSource).toContain(
      "normalizeInitRequiredInputError(error, errorRecoveryContext)",
    );

    const flowSource = source("../../src/commands/flow.ts");
    expect(flowSource).toContain(
      "errorRecoveryContext = { chain: recipientChain };",
    );
    expect(flowSource).toContain("recoveryDetails: errorRecoveryContext");
    expect(
      countMatches(
        flowSource,
        /recoveryDetails: flowRecoveryDetailsForWorkflow\(workflowId, error\)/g,
      ),
    ).toBe(4);

    const setupRecoverySource = source("../../src/utils/setup-recovery.ts");
    expect(setupRecoverySource).toContain(
      "withErrorRecoveryContext(error, recoveryDetails)",
    );
  });

  test("workflow services classify thrown and persisted errors with chain context", () => {
    const workflowSource = source("../../src/services/workflow.ts");

    expect(workflowSource).toContain(
      "const classified = classifyError(error, recoveryDetails);",
    );
    expect(
      countMatches(
        workflowSource,
        /buildFlowLastError\([^)]*error,\s*\{\s*chain:/gs,
      ),
    ).toBe(3);
    expect(
      countMatches(
        workflowSource,
        /throw withErrorRecoveryContext\(error, \{ chain: chainConfig\.name \}\);/g,
      ),
    ).toBe(1);
    expect(
      countMatches(
        workflowSource,
        /throw withErrorRecoveryContext\(error, \{ chain: latestSnapshot\.chain \}\);/g,
      ),
    ).toBe(2);
    expect(
      countMatches(
        workflowSource,
        /throw withErrorRecoveryContext\(error, \{ chain: loadedSnapshot\.chain \}\);/g,
      ),
    ).toBe(1);
  });
});
