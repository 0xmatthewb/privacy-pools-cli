const ENV_RUNTIME_DEBUG = "PRIVACY_POOLS_DEBUG_RUNTIME";

export interface RuntimeDiagnosticPayload {
  [key: string]: string | number | boolean | null | undefined;
}

export function isRuntimeDiagnosticsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ENV_RUNTIME_DEBUG]?.trim() === "1";
}

function formatRuntimeDiagnosticPayload(
  payload: RuntimeDiagnosticPayload,
): string {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

export function emitRuntimeDiagnostic(
  event: string,
  payload: RuntimeDiagnosticPayload = {},
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isRuntimeDiagnosticsEnabled(env)) {
    return;
  }

  const formattedPayload = formatRuntimeDiagnosticPayload(payload);
  const suffix = formattedPayload ? ` ${formattedPayload}` : "";
  process.stderr.write(`[privacy-pools runtime] ${event}${suffix}\n`);
}

export function runtimeStopwatch(): bigint {
  return process.hrtime.bigint();
}

export function elapsedRuntimeMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}
