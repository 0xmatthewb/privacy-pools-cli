import { JSON_SCHEMA_VERSION } from "./json.js";

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
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: JSON_SCHEMA_VERSION,
      success: true,
      ...event,
    })}\n`,
  );
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
