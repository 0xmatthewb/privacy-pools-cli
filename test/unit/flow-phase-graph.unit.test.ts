import { describe, expect, test } from "bun:test";
import {
  FLOW_EXTERNAL_MUTATION_TRIGGER,
  FLOW_PHASE_GRAPH,
  getExternalMutationFlowPhase,
  isPausedFlowPhase,
  isTerminalFlowPhase,
} from "../../src/services/flow-phase-graph.ts";
import { FLOW_PHASE_VALUES, type FlowPhase } from "../../src/types.ts";

describe("flow phase graph", () => {
  test("uses the canonical phase list and explicit terminal/paused sets", () => {
    expect(FLOW_PHASE_GRAPH.nodes).toEqual([...FLOW_PHASE_VALUES]);
    expect(FLOW_PHASE_GRAPH.terminal).toEqual(
      FLOW_PHASE_VALUES.filter((phase) => isTerminalFlowPhase(phase)),
    );
    expect(FLOW_PHASE_GRAPH.paused).toEqual([
      "paused_declined",
      "paused_poa_required",
    ]);
    expect(FLOW_PHASE_GRAPH.paused.every(isPausedFlowPhase)).toBe(true);
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

  test("every non-terminal phase is reachable and has graph-backed mutation recovery", () => {
    const edgesBySource = new Map<FlowPhase, FlowPhase[]>();
    for (const edge of FLOW_PHASE_GRAPH.edges) {
      const current = edgesBySource.get(edge.from) ?? [];
      current.push(edge.to);
      edgesBySource.set(edge.from, current);
    }

    const reachable = new Set<FlowPhase>();
    const queue: FlowPhase[] = ["awaiting_funding"];
    while (queue.length > 0) {
      const phase = queue.shift()!;
      if (reachable.has(phase)) continue;
      reachable.add(phase);
      queue.push(...(edgesBySource.get(phase) ?? []));
    }

    expect(reachable).toEqual(new Set(FLOW_PHASE_VALUES));
    for (const phase of FLOW_PHASE_VALUES) {
      if (isTerminalFlowPhase(phase)) {
        expect(getExternalMutationFlowPhase(phase)).toBeNull();
      } else {
        expect(getExternalMutationFlowPhase(phase)).toBe("stopped_external");
        expect(FLOW_PHASE_GRAPH.edges).toContainEqual({
          from: phase,
          to: "stopped_external",
          trigger: FLOW_EXTERNAL_MUTATION_TRIGGER,
        });
      }
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
