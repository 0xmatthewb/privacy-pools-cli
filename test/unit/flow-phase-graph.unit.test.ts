import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  FLOW_EXTERNAL_MUTATION_TRIGGER,
  FLOW_PHASE_GRAPH,
  getExternalMutationFlowPhase,
  isPausedFlowPhase,
  isTerminalFlowPhase,
} from "../../src/services/flow-phase-graph.ts";
import { FLOW_PHASE_VALUES, type FlowPhase } from "../../src/types.ts";

function edgeKey(from: FlowPhase, to: FlowPhase): string {
  return `${from}->${to}`;
}

function collectWorkflowPhaseAssignmentInventory(
  source: string,
): Record<string, number> {
  const inventory: Record<string, number> = {};
  let currentFunction = "module";
  for (const line of source.split("\n")) {
    const functionMatch = line.match(
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
    );
    if (functionMatch?.[1]) {
      currentFunction = functionMatch[1];
    }

    const literalPhaseMatch = line.match(/phase: "([a-z_]+)"/);
    const dynamicPhaseMatch = line.match(/phase: mutationPhase/);
    const phase = literalPhaseMatch?.[1] ?? (dynamicPhaseMatch ? "mutationPhase" : null);
    if (!phase) continue;
    const key = `${currentFunction}:${phase}`;
    inventory[key] = (inventory[key] ?? 0) + 1;
  }
  return inventory;
}

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

  test("keeps workflow-emitted phase transitions represented in the graph", () => {
    const workflowSource = readFileSync(
      new URL("../../src/services/workflow.ts", import.meta.url),
      "utf8",
    );
    expect(collectWorkflowPhaseAssignmentInventory(workflowSource)).toEqual({
      "applyFlowPrivacyDelayPolicy:approved_ready_to_withdraw": 1,
      "applyFlowPrivacyDelayPolicy:approved_waiting_privacy_delay": 1,
      "scheduleApprovedWorkflowPrivacyDelay:approved_ready_to_withdraw": 1,
      "scheduleApprovedWorkflowPrivacyDelay:approved_waiting_privacy_delay": 1,
      "saveMutatedWorkflowSnapshot:mutationPhase": 1,
      "attachDepositResultToSnapshot:awaiting_asp": 1,
      "attachPendingDepositToSnapshot:depositing_publicly": 1,
      "attachPendingWithdrawalToSnapshot:withdrawing": 1,
      "attachWithdrawalResultToSnapshot:completed": 1,
      "attachRagequitResultToSnapshot:completed_public_recovery": 1,
      "reconcilePendingRagequitReceipt:mutationPhase": 1,
      "inspectFundingAndDeposit:awaiting_funding": 2,
      "inspectFundingAndDeposit:depositing_publicly": 2,
      "continueApprovedWorkflowWithdrawal:mutationPhase": 2,
      "continueApprovedWorkflowWithdrawal:withdrawing": 1,
      "inspectAndAdvanceFlow:approved_waiting_privacy_delay": 2,
      "inspectAndAdvanceFlow:paused_declined": 1,
      "inspectAndAdvanceFlow:paused_poa_required": 1,
      "inspectAndAdvanceFlow:awaiting_asp": 1,
      "inspectAndAdvanceFlow:approved_ready_to_withdraw": 1,
      "setupNewWalletWorkflow:awaiting_funding": 1,
      "startWorkflow:depositing_publicly": 2,
    });

    const workflowTransitions: Array<{ from: FlowPhase; to: FlowPhase }> = [
      { from: "awaiting_funding", to: "depositing_publicly" },
      { from: "depositing_publicly", to: "awaiting_funding" },
      { from: "depositing_publicly", to: "awaiting_asp" },
      { from: "awaiting_asp", to: "approved_waiting_privacy_delay" },
      { from: "awaiting_asp", to: "approved_ready_to_withdraw" },
      { from: "awaiting_asp", to: "paused_declined" },
      { from: "awaiting_asp", to: "paused_poa_required" },
      { from: "paused_poa_required", to: "awaiting_asp" },
      {
        from: "approved_waiting_privacy_delay",
        to: "approved_ready_to_withdraw",
      },
      {
        from: "approved_ready_to_withdraw",
        to: "approved_waiting_privacy_delay",
      },
      { from: "approved_ready_to_withdraw", to: "withdrawing" },
      { from: "withdrawing", to: "completed" },
    ];
    const workflowTransitionKeys = new Set(
      workflowTransitions.map((transition) =>
        edgeKey(transition.from, transition.to)
      ),
    );
    const graphModeledWorkflowKeys = new Set(
      FLOW_PHASE_GRAPH.edges
        .filter(
          (edge) =>
            edge.trigger !== FLOW_EXTERNAL_MUTATION_TRIGGER &&
            edge.trigger !== "operator runs flow ragequit",
        )
        .map((edge) => edgeKey(edge.from, edge.to)),
    );
    expect(graphModeledWorkflowKeys).toEqual(workflowTransitionKeys);

    for (const phase of FLOW_PHASE_VALUES) {
      if (isTerminalFlowPhase(phase)) continue;
      expect(
        FLOW_PHASE_GRAPH.edges.some(
          (edge) =>
            edge.from === phase &&
            edge.to === "completed_public_recovery" &&
            edge.trigger === "operator runs flow ragequit",
        ),
        `${phase} -> completed_public_recovery`,
      ).toBe(true);
    }
  });
});
