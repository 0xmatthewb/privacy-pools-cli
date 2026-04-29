import { describe, expect, test } from "bun:test";
import { ERROR_CODE_REGISTRY } from "../../src/utils/error-code-registry.ts";
import {
  ERROR_RECOVERY_TABLE,
  type ErrorRecoveryClassification,
} from "../../src/utils/error-recovery-table.ts";
import {
  CLIError,
  classifyError,
  printError,
  type ErrorCategory,
} from "../../src/utils/errors.ts";
import { clearProcessExitCode, restoreProcessExitCode } from "../helpers/process.ts";

function captureStdout(run: () => void): string {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

describe("error recovery nextActions conformance", () => {
  test("every registered error code has an explicit recovery classification", () => {
    const classifications = new Set<ErrorRecoveryClassification>([
      "actionable",
      "retry-only",
      "terminal-input",
    ]);

    expect(Object.keys(ERROR_RECOVERY_TABLE).sort()).toEqual(
      Object.keys(ERROR_CODE_REGISTRY).sort(),
    );
    for (const [code, entry] of Object.entries(ERROR_RECOVERY_TABLE)) {
      expect(classifications.has(entry.classification), code).toBe(true);
    }
  });

  test("every actionable code classifies with non-empty error.extra.nextActions", () => {
    const actionableCodes = Object.entries(ERROR_RECOVERY_TABLE)
      .filter(([, entry]) => entry.classification === "actionable")
      .map(([code]) => code);

    expect(actionableCodes.length).toBeGreaterThan(0);

    for (const code of actionableCodes) {
      const registryEntry = ERROR_CODE_REGISTRY[code as keyof typeof ERROR_CODE_REGISTRY];
      const classified = classifyError(
        new CLIError(
          "synthetic actionable error",
          registryEntry.category as ErrorCategory,
          "synthetic hint",
          code,
          registryEntry.retryable,
          "inline",
          {
            amount: "0.0734",
            suggestedRoundAmount: "0.07",
            asset: "ETH",
            recipient: "0x0000000000000000000000000000000000000001",
            chain: "mainnet",
            submissionId: "123e4567-e89b-12d3-a456-426614174000",
            poolAccountId: "PA-1",
            workflowId: "latest",
            aspStatus: "pending",
          },
        ),
      );

      expect(classified.extra.nextActions?.length, code).toBeGreaterThan(0);
    }
  });

  test("direct CLIError construction populates recovery nextActions", () => {
    const error = new CLIError(
      "quote expired",
      "RELAYER",
      "request a fresh quote",
      "RELAYER_BROADCAST_QUOTE_EXPIRED",
      true,
      "inline",
      {
        amount: "0.1",
        asset: "ETH",
        recipient: "0x0000000000000000000000000000000000000001",
        chain: "mainnet",
      },
    );

    expect(error.extra.nextActions?.[0]).toMatchObject({
      command: "withdraw quote",
      cliCommand:
        "privacy-pools withdraw quote 0.1 ETH --agent --chain mainnet --to 0x0000000000000000000000000000000000000001",
    });
  });

  test("JSON error output mirrors recovery nextActions at top level and nested error", () => {
    clearProcessExitCode();
    const stdout = captureStdout(() => {
      printError(
        new CLIError(
          "amount may fingerprint this transaction",
          "INPUT",
          "retry with a round amount",
          "INPUT_NONROUND_AMOUNT",
          false,
          "inline",
          {
            command: "deposit",
            amount: "0.0734",
            suggestedRoundAmount: "0.07",
            asset: "ETH",
            chain: "mainnet",
          },
        ),
        true,
      );
    });
    restoreProcessExitCode();

    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.nextActions?.length).toBeGreaterThan(0);
    expect(json.error.nextActions).toEqual(json.nextActions);
    expect(json.nextActions[0]).toMatchObject({
      command: "deposit",
      cliCommand: "privacy-pools deposit 0.07 ETH --agent --chain mainnet",
    });
  });
});
