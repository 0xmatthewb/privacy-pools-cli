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
  withErrorRecoveryContext,
  type ErrorCategory,
} from "../../src/utils/errors.ts";
import { validateRelayerQuoteForWithdrawal } from "../../src/commands/withdraw/quote.ts";
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
      expect(JSON.stringify(classified.extra.nextActions), code).not.toMatch(/<[^>]+>/);
      for (const action of classified.extra.nextActions ?? []) {
        if (action.cliCommand) {
          expect(action.cliCommand, code).not.toMatch(/<[^>]+>/);
        }
      }
    }
  });

  test("chain-scoped recovery commands preserve provided chain context", () => {
    const cases = [
      {
        rawError: "execution reverted: IncorrectASPRoot",
        code: "CONTRACT_INCORRECT_ASP_ROOT",
        cliCommand: "privacy-pools sync --agent --chain sepolia",
      },
      {
        rawError: "execution reverted: UnknownStateRoot",
        code: "CONTRACT_UNKNOWN_STATE_ROOT",
        cliCommand: "privacy-pools sync --agent --chain sepolia",
      },
      {
        rawError: "execution reverted: NullifierAlreadySpent",
        code: "CONTRACT_NULLIFIER_ALREADY_SPENT",
        cliCommand: "privacy-pools accounts --agent --chain sepolia",
      },
    ];

    for (const testCase of cases) {
      const classified = classifyError(
        new Error(testCase.rawError),
        { chain: "sepolia" },
      );
      expect(classified.code).toBe(testCase.code);
      expect(classified.extra.nextActions?.[0]?.cliCommand).toBe(
        testCase.cliCommand,
      );
      expect(classified.extra.nextActions?.[0]?.cliCommand).toContain(
        "--chain sepolia",
      );
    }

    const nonRoundAmount = new CLIError(
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
        chain: "sepolia",
      },
    );

    expect(nonRoundAmount.extra.nextActions?.[0]?.cliCommand).toContain(
      "--chain sepolia",
    );
  });

  test("retry-only codes expose retry policy in error JSON", () => {
    clearProcessExitCode();
    const stdout = captureStdout(() => {
      printError(
        new CLIError(
          "lock held",
          "INPUT",
          "wait and retry",
          "LOCK_HELD",
          true,
        ),
        true,
      );
    });
    restoreProcessExitCode();

    const json = JSON.parse(stdout);
    expect(json.success).toBe(false);
    expect(json.retry).toMatchObject({
      strategy: "fixed-backoff",
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
    });
    expect(json.error.retry).toEqual(json.retry);
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

  test("production recovery contexts render runnable high-value commands", () => {
    const contractError = withErrorRecoveryContext(
      new Error("execution reverted: IncorrectASPRoot"),
      { chain: "sepolia" },
    );
    expect(contractError.extra.nextActions?.[0]?.cliCommand).toBe(
      "privacy-pools sync --agent --chain sepolia",
    );

    try {
      validateRelayerQuoteForWithdrawal(
        {
          feeBPS: "750",
          feeCommitment: { expiration: Date.now() + 60_000 },
        } as never,
        500n,
        {
          amountInput: "0.1",
          assetInput: "ETH",
          recipient: "0x0000000000000000000000000000000000000001",
          chainName: "mainnet",
        },
      );
      throw new Error("expected relayer fee validation to fail");
    } catch (error) {
      const classified = classifyError(error);
      expect(classified.code).toBe("RELAYER_FEE_EXCEEDS_MAX");
      expect(classified.extra.nextActions?.[0]?.cliCommand).toBe(
        "privacy-pools withdraw quote 0.1 ETH --agent --chain mainnet --to 0x0000000000000000000000000000000000000001",
      );
    }
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
