/**
 * Agent nextActions eval — validates that structured nextActions are emitted
 * and that the harness correctly handles runnable vs non-runnable actions.
 */

import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";
import {
  runEvalScenario,
  extractNextActions,
  extractFirstRunnableAction,
  buildArgsFromNextAction,
  isRunnableAction,
  type EvalScenario,
  type NextAction,
} from "./helpers/eval-harness.ts";

describe("agent nextActions eval", () => {
  test("unconfigured status emits nextActions recommending init", () => {
    const home = createTempHome();

    const scenario: EvalScenario = {
      name: "unconfigured-status",
      description: "Status without wallet should suggest init",
      steps: [
        {
          command: ["status"],
          expectedStatus: 0,
          assertions: (_result, parsed) => {
            const p = parsed as Record<string, unknown>;
            expect(p.success).toBe(true);

            const actions = extractNextActions(parsed);
            // Should have at least one nextAction mentioning init
            const initAction = actions.find(
              (a) =>
                a.command === "init" ||
                a.command.includes("init"),
            );
            expect(initAction).toBeDefined();
          },
        },
      ],
    };

    const results = runEvalScenario(scenario, {
      runner: runCli,
      home,
    });

    expect(results).toHaveLength(1);
    expect(results[0].result.status).toBe(0);
    scenario.steps[0].assertions?.(results[0].result, results[0].parsed);
  });

  test("harness refuses to auto-follow runnable: false actions", () => {
    // Create a synthetic nextAction with runnable: false
    const templateAction: NextAction = {
      command: "init",
      reason: "Wallet not configured",
      runnable: false,
      args: [],
      options: { "default-chain": "mainnet" },
    };

    expect(isRunnableAction(templateAction)).toBe(false);

    // Verify the harness would skip it
    const runnableAction: NextAction = {
      command: "status",
      reason: "Check configuration",
      runnable: true,
    };

    expect(isRunnableAction(runnableAction)).toBe(true);

    // Action without explicit runnable field defaults to runnable
    const implicitRunnable: NextAction = {
      command: "pools",
      reason: "Browse pools",
    };
    expect(isRunnableAction(implicitRunnable)).toBe(true);
  });

  test("buildArgsFromNextAction produces correct CLI args", () => {
    const action: NextAction = {
      command: "withdraw quote",
      args: ["0.1", "ETH"],
      options: {
        to: "0xRecipient",
        chain: "mainnet",
      },
    };

    const args = buildArgsFromNextAction(action);
    expect(args).toContain("withdraw");
    expect(args).toContain("quote");
    expect(args).toContain("0.1");
    expect(args).toContain("ETH");
    expect(args).toContain("--to");
    expect(args).toContain("0xRecipient");
    expect(args).toContain("--chain");
    expect(args).toContain("mainnet");
  });

  test("buildArgsFromNextAction converts camelCase to kebab-case and handles false booleans", () => {
    const action: NextAction = {
      command: "init",
      options: {
        showRecoveryPhrase: true,
        defaultChain: "mainnet",
        extraGas: false,
      },
    };

    const args = buildArgsFromNextAction(action);
    expect(args).toContain("--show-recovery-phrase");
    expect(args).not.toContain("--showRecoveryPhrase");
    expect(args).toContain("--default-chain");
    expect(args).not.toContain("--defaultChain");
    expect(args).toContain("--no-extra-gas");
    expect(args).not.toContain("--extraGas");
  });

  test("followNextActions: status → init end-to-end", () => {
    const home = createTempHome();

    const scenario: EvalScenario = {
      name: "follow-nextactions-e2e",
      description: "Harness auto-follows status nextAction to init and succeeds",
      steps: [
        {
          command: ["status"],
          expectedStatus: 0,
          followNextActions: true,
          assertions: (_result, parsed) => {
            const p = parsed as Record<string, unknown>;
            expect(p.success).toBe(true);
            // Should emit an init nextAction
            const actions = extractNextActions(parsed);
            expect(actions.some((a) => a.command === "init")).toBe(true);
          },
        },
      ],
    };

    const results = runEvalScenario(scenario, {
      runner: runCli,
      home,
    });

    // Step 0: status succeeded and emitted nextAction
    expect(results[0].result.status).toBe(0);
    expect(results[0].followedAction).toBeDefined();
    expect(results[0].followedAction!.command).toBe("init");

    // Step 1: the followed init command ran and succeeded
    expect(results).toHaveLength(2);
    expect(results[1].result.status).toBe(0);
    const initParsed = results[1].parsed as Record<string, unknown>;
    expect(initParsed.success).toBe(true);
  });

  test("extractFirstRunnableAction skips non-runnable", () => {
    const payload = {
      success: true,
      nextActions: [
        { command: "init", runnable: false, reason: "template" },
        { command: "status", runnable: true, reason: "check" },
        { command: "pools", reason: "browse" },
      ],
    };

    const action = extractFirstRunnableAction(payload);
    expect(action).toBeDefined();
    expect(action!.command).toBe("status");
  });
});
