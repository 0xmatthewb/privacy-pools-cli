import { JSON_SCHEMA_VERSION } from "./json.js";

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
