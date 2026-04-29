import {
  FLOW_PHASE_VALUES,
  type FlowPhase,
  type FlowPhaseGraph,
} from "../types.js";

const FLOW_PHASE_PAUSED_ORDER = [
  "paused_declined",
  "paused_poa_required",
] as const satisfies readonly FlowPhase[];

export const FLOW_EXTERNAL_MUTATION_TRIGGER =
  "external spend or local workflow mutation is detected";

export const FLOW_PHASE_GRAPH = {
  nodes: [...FLOW_PHASE_VALUES],
  edges: [
    {
      from: "awaiting_funding",
      to: "depositing_publicly",
      trigger: "flow step observes dedicated workflow wallet funding",
    },
    {
      from: "depositing_publicly",
      to: "awaiting_asp",
      trigger: "public deposit confirms onchain",
    },
    {
      from: "depositing_publicly",
      to: "awaiting_funding",
      trigger: "clean public deposit submission failure clears pending deposit state",
    },
    {
      from: "awaiting_asp",
      to: "approved_waiting_privacy_delay",
      trigger: "ASP status is approved and a privacy delay is active",
    },
    {
      from: "awaiting_asp",
      to: "approved_ready_to_withdraw",
      trigger: "ASP status is approved and privacy delay is complete or off",
    },
    {
      from: "awaiting_asp",
      to: "paused_declined",
      trigger: "ASP status is declined",
    },
    {
      from: "awaiting_asp",
      to: "paused_poa_required",
      trigger: "ASP status is poa_required",
    },
    {
      from: "approved_waiting_privacy_delay",
      to: "approved_ready_to_withdraw",
      trigger: "privacy delay expires",
    },
    {
      from: "approved_ready_to_withdraw",
      to: "approved_waiting_privacy_delay",
      trigger: "operator reschedules an active privacy delay",
    },
    {
      from: "paused_poa_required",
      to: "awaiting_asp",
      trigger: "operator completes PoA externally and the next status refresh observes review progress",
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
    ...FLOW_PHASE_VALUES.filter((phase) => !isTerminalFlowPhase(phase)).map((phase) => ({
      from: phase,
      to: "completed_public_recovery" as FlowPhase,
      trigger: "operator runs flow ragequit",
    })),
    ...FLOW_PHASE_VALUES.filter((phase) => !isTerminalFlowPhase(phase)).map((phase) => ({
      from: phase,
      to: "stopped_external" as FlowPhase,
      trigger: FLOW_EXTERNAL_MUTATION_TRIGGER,
    })),
  ],
  terminal: FLOW_PHASE_VALUES.filter(isTerminalFlowPhase),
  paused: FLOW_PHASE_PAUSED_ORDER.filter(isPausedFlowPhase),
} satisfies FlowPhaseGraph;

export function isTerminalFlowPhase(phase: FlowPhase): boolean {
  return (
    phase === "completed" ||
    phase === "completed_public_recovery" ||
    phase === "stopped_external"
  );
}

export function isPausedFlowPhase(phase: FlowPhase): boolean {
  return phase === "paused_declined" || phase === "paused_poa_required";
}

export function getExternalMutationFlowPhase(
  phase: FlowPhase,
): FlowPhase | null {
  return FLOW_PHASE_GRAPH.edges.some(
    (edge) =>
      edge.from === phase &&
      edge.to === "stopped_external" &&
      edge.trigger === FLOW_EXTERNAL_MUTATION_TRIGGER,
  )
    ? "stopped_external"
    : null;
}
