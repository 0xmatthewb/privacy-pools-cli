import { describe, expect, test } from "bun:test";
import {
  FLOW_PHASE_GRAPH,
  isPausedPhase,
  isTerminalPhase,
} from "../../src/services/flow-phase-graph.ts";
import { FLOW_PHASE_VALUES, type FlowPhase } from "../../src/types.ts";

describe("flow phase graph", () => {
  test("uses the canonical phase list and explicit terminal/paused sets", () => {
    expect(FLOW_PHASE_GRAPH.nodes).toEqual([...FLOW_PHASE_VALUES]);
    expect(FLOW_PHASE_GRAPH.terminal).toEqual(
      FLOW_PHASE_VALUES.filter((phase) => isTerminalPhase(phase)),
    );
    expect([...FLOW_PHASE_GRAPH.paused].sort()).toEqual(
      FLOW_PHASE_VALUES.filter((phase) => isPausedPhase(phase)).sort(),
    );
  });

  test("every edge connects known phases and includes an agent-readable trigger", () => {
    const phases = new Set<FlowPhase>(FLOW_PHASE_VALUES);

    expect(FLOW_PHASE_GRAPH.edges.length).toBeGreaterThan(FLOW_PHASE_VALUES.length);
    for (const edge of FLOW_PHASE_GRAPH.edges) {
      expect(phases.has(edge.from), `${edge.from} -> ${edge.to}`).toBe(true);
      expect(phases.has(edge.to), `${edge.from} -> ${edge.to}`).toBe(true);
      expect(edge.trigger.trim().length, `${edge.from} -> ${edge.to}`).toBeGreaterThan(0);
    }
  });

  test("models the main private path plus public recovery escape", () => {
    expect(FLOW_PHASE_GRAPH.edges).toEqual(
      expect.arrayContaining([
        {
          from: "awaiting_asp",
          to: "approved_ready_to_withdraw",
          trigger: "ASP status is approved and privacy delay is complete or off",
        },
        {
          from: "approved_ready_to_withdraw",
          to: "withdrawing",
          trigger: "relayed withdrawal is submitted",
        },
        {
          from: "withdrawing",
          to: "completed",
          trigger: "relayed private withdrawal confirms",
        },
        {
          from: "paused_declined",
          to: "completed_public_recovery",
          trigger: "operator runs flow ragequit",
        },
      ]),
    );
  });
});
