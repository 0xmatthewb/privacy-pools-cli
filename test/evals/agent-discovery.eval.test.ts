/**
 * Agent discovery eval — validates that an agent can discover CLI capabilities
 * and drill into individual command contracts.
 */

import { describe, expect, test } from "bun:test";
import { createTempHome, runCli, parseJsonOutput } from "../helpers/cli.ts";
import {
  runEvalScenario,
  type EvalScenario,
} from "./helpers/eval-harness.ts";

describe("agent discovery eval", () => {
  test("capabilities → describe deposit: structured discovery flow", () => {
    const home = createTempHome();

    const scenario: EvalScenario = {
      name: "discovery-flow",
      description: "Agent discovers CLI capabilities, then drills into deposit command",
      steps: [
        {
          command: ["capabilities"],
          expectedStatus: 0,
          assertions: (_result, parsed) => {
            const p = parsed as Record<string, unknown>;
            expect(p.success).toBe(true);
            expect(p.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
            expect(Array.isArray(p.commands)).toBe(true);
            expect((p.commands as string[]).length).toBeGreaterThan(5);
            expect(typeof p.commandDetails).toBe("object");
          },
        },
        {
          command: ["describe", "deposit"],
          expectedStatus: 0,
          assertions: (_result, parsed) => {
            const p = parsed as Record<string, unknown>;
            expect(p.success).toBe(true);
            expect(p.command).toBe("deposit");
            expect(typeof p.description).toBe("string");
            expect(Array.isArray(p.flags)).toBe(true);
          },
        },
      ],
    };

    const results = runEvalScenario(scenario, {
      runner: runCli,
      home,
    });

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.result.status).toBe(0);
      const step = scenario.steps[r.stepIndex];
      step.assertions?.(r.result, r.parsed);
    }
  });

  test("read-only chain: capabilities → status → pools", () => {
    const home = createTempHome();

    const scenario: EvalScenario = {
      name: "read-only-chain",
      description: "Agent runs read-only commands without wallet setup",
      steps: [
        {
          command: ["capabilities"],
          expectedStatus: 0,
        },
        {
          command: ["status"],
          expectedStatus: 0,
          assertions: (_result, parsed) => {
            const p = parsed as Record<string, unknown>;
            expect(p.success).toBe(true);
            expect(p.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
            // configDir may be null when unconfigured
            expect("configDir" in p).toBe(true);
          },
        },
      ],
    };

    const results = runEvalScenario(scenario, {
      runner: runCli,
      home,
    });

    for (const r of results) {
      expect(r.result.status).toBe(0);
      const step = scenario.steps[r.stepIndex];
      step.assertions?.(r.result, r.parsed);
    }
  });
});
