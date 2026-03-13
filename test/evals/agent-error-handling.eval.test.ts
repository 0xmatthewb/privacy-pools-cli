/**
 * Agent error handling eval — validates prerequisite gating and
 * error envelope structure for unconfigured CLI states.
 */

import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";
import {
  runEvalScenario,
  isRetryableError,
  isRunnableAction,
  type EvalScenario,
} from "./helpers/eval-harness.ts";

describe("agent error handling eval", () => {
  test("accounts without init exits 2 with INPUT error mentioning recovery phrase", () => {
    const home = createTempHome();

    const scenario: EvalScenario = {
      name: "accounts-no-init",
      description: "accounts requires recovery phrase",
      steps: [
        {
          command: ["accounts"],
          expectedStatus: 2,
          assertions: (result, parsed) => {
            const p = parsed as Record<string, unknown>;
            expect(p.success).toBe(false);
            expect(typeof p.error).toBe("object");
            const err = p.error as Record<string, unknown>;
            expect(err.category).toBe("INPUT");
            // accounts needs the mnemonic (recovery phrase)
            const msg = String(err.message ?? "").toLowerCase();
            const hint = String(err.hint ?? "").toLowerCase();
            const combined = `${msg} ${hint}`;
            expect(
              combined.includes("recovery phrase") ||
              combined.includes("mnemonic") ||
              combined.includes("init"),
            ).toBe(true);
          },
        },
      ],
    };

    const results = runEvalScenario(scenario, {
      runner: runCli,
      home,
    });

    expect(results).toHaveLength(1);
    expect(results[0].result.status).toBe(2);
    scenario.steps[0].assertions?.(results[0].result, results[0].parsed);
  });

  test("withdraw without init exits 2 with INPUT error mentioning signer key", () => {
    const home = createTempHome();

    const scenario: EvalScenario = {
      name: "withdraw-no-init",
      description: "withdraw requires signer key",
      steps: [
        {
          command: ["withdraw", "0.1", "ETH", "--to", "0x0000000000000000000000000000000000000001"],
          expectedStatus: 2,
          assertions: (result, parsed) => {
            const p = parsed as Record<string, unknown>;
            expect(p.success).toBe(false);
            expect(typeof p.error).toBe("object");
            const err = p.error as Record<string, unknown>;
            expect(err.category).toBe("INPUT");
            // withdraw needs either signer key or recovery phrase
            const msg = String(err.message ?? "").toLowerCase();
            const hint = String(err.hint ?? "").toLowerCase();
            const combined = `${msg} ${hint}`;
            expect(
              combined.includes("signer") ||
              combined.includes("private key") ||
              combined.includes("privacy_pools_private_key") ||
              combined.includes("recovery phrase") ||
              combined.includes("mnemonic") ||
              combined.includes("init"),
            ).toBe(true);
          },
        },
      ],
    };

    const results = runEvalScenario(scenario, {
      runner: runCli,
      home,
    });

    expect(results).toHaveLength(1);
    expect(results[0].result.status).toBe(2);
    scenario.steps[0].assertions?.(results[0].result, results[0].parsed);
  });

  test("INPUT errors are not retryable", () => {
    const inputError = {
      success: false,
      error: {
        category: "INPUT",
        code: "INPUT_ERROR",
        retryable: false,
        message: "Recovery phrase not found",
      },
    };
    expect(isRetryableError(inputError)).toBe(false);
  });

  test("RPC errors are retryable", () => {
    const rpcError = {
      success: false,
      error: {
        category: "RPC",
        code: "RPC_ERROR",
        retryable: true,
        message: "Connection timeout",
      },
    };
    expect(isRetryableError(rpcError)).toBe(true);
  });

  test("isRunnableAction unit tests", () => {
    expect(isRunnableAction({ command: "init", runnable: false })).toBe(false);
    expect(isRunnableAction({ command: "init", runnable: true })).toBe(true);
    expect(isRunnableAction({ command: "init" })).toBe(true);
  });
});
