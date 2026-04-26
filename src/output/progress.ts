import {
  accent,
  directionDeposit,
  directionRecovery,
  directionWithdraw,
  faint,
  muted,
  statusHealthy,
  statusPending,
} from "../utils/theme.js";
import { glyph } from "../utils/symbols.js";
import { supportsUnicodeOutput } from "../utils/terminal.js";

export type NarrativeStepState = "done" | "active" | "pending" | "blocked";
export type FlowRailStepState =
  | "done"
  | "active"
  | "pending"
  | "blocked"
  | "skipped";

export interface NarrativeStep {
  label: string;
  state: NarrativeStepState;
  note?: string;
}

export interface FlowRailStep {
  label: string;
  state: FlowRailStepState;
  note?: string;
}

export function createNarrativeSteps(
  labels: string[],
  activeIndex: number,
  note?: string,
): NarrativeStep[] {
  return labels.map((label, index) => ({
    label,
    state: index < activeIndex
      ? "done"
      : index === activeIndex
        ? "active"
        : "pending",
    ...(index === activeIndex && note ? { note } : {}),
  }));
}

function renderStepMarker(state: NarrativeStepState | FlowRailStepState): string {
  switch (state) {
    case "done":
      return statusHealthy(glyph("active"));
    case "active":
      return accent(glyph("active"));
    case "blocked":
      return directionRecovery(glyph("warning"));
    case "skipped":
      return faint(supportsUnicodeOutput() ? "·" : "-");
    default:
      return faint(glyph("pending"));
  }
}

function renderStepLabel(step: { label: string; state: NarrativeStepState | FlowRailStepState }): string {
  switch (step.state) {
    case "done":
      return statusHealthy(step.label);
    case "active":
      return accent(step.label);
    case "blocked":
      return directionRecovery(step.label);
    case "skipped":
      return muted(step.label);
    default:
      return muted(step.label);
  }
}

export function renderNarrativeSteps(steps: NarrativeStep[]): string {
  if (steps.length === 0) return "";

  return `${steps
    .map((step) => {
      const prefix = renderStepMarker(step.state);
      const label = renderStepLabel(step);
      const note = step.note ? ` ${muted(`- ${step.note}`)}` : "";
      return `  ${prefix} ${label}${note}`;
    })
    .join("\n")}\n`;
}

export function createNarrativeProgressWriter(
  options: { silent?: boolean; stream?: NodeJS.WriteStream } = {},
): (steps: NarrativeStep[]) => void {
  const stream = options.stream ?? process.stderr;
  let renderedLineCount = 0;

  return (steps: NarrativeStep[]) => {
    if (options.silent) return;

    const rendered = renderNarrativeSteps(steps);
    if (!rendered) return;

    if (renderedLineCount > 0 && stream.isTTY) {
      stream.write(`\x1b[${renderedLineCount}A\x1b[J`);
    } else if (renderedLineCount === 0) {
      stream.write("\n");
    }

    stream.write(rendered);
    renderedLineCount = rendered.split("\n").length - 1;
  };
}

export function renderFlowRail(steps: FlowRailStep[]): string {
  if (steps.length === 0) return "";

  const connector = faint(" -> ");
  const rail = steps
    .map((step) => `${renderStepMarker(step.state)} ${renderStepLabel(step)}`)
    .join(connector);
  const noteLines = steps
    .filter((step) => step.note && (step.state === "active" || step.state === "blocked"))
    .map((step) => `    ${muted(step.note!)}`);

  return noteLines.length > 0
    ? `  ${rail}\n${noteLines.join("\n")}\n`
    : `  ${rail}\n`;
}

export function renderOutcomeDirection(
  kind: "deposit" | "withdraw" | "recovery",
): (value: string) => string {
  switch (kind) {
    case "deposit":
      return directionDeposit;
    case "withdraw":
      return directionWithdraw;
    default:
      return directionRecovery;
  }
}
