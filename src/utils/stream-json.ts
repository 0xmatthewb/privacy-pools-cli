import { printJsonSuccess } from "./json.js";

export const PROOF_STREAM_STAGES = [
  "loading_circuits",
  "generating_proof",
  "verifying_proof",
] as const;

export type ProofStreamStage = (typeof PROOF_STREAM_STAGES)[number];

export function emitStreamJsonEvent(
  enabled: boolean | undefined,
  event: Record<string, unknown>,
): void {
  if (!enabled) return;
  printJsonSuccess(event);
}

export function emitProofStreamStage(
  enabled: boolean | undefined,
  baseEvent: Record<string, unknown> | undefined,
  stage: ProofStreamStage,
): void {
  if (!baseEvent) return;
  emitStreamJsonEvent(enabled, {
    ...baseEvent,
    event: "stage",
    stage,
  });
}
