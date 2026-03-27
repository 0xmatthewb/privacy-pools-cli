export const WORKER_PROTOCOL_VERSION = "1" as const;
export const WORKER_REQUEST_ENV = "PRIVACY_POOLS_WORKER_REQUEST_B64";

export interface WorkerRequestV1 {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  argv: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createWorkerRequestV1(argv: string[]): WorkerRequestV1 {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    argv: [...argv],
  };
}

export function encodeWorkerRequestV1(request: WorkerRequestV1): string {
  return Buffer.from(JSON.stringify(request), "utf8").toString("base64");
}

export function decodeWorkerRequestV1(encoded: string): WorkerRequestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Malformed worker request envelope.");
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Worker request must be an object.");
  }

  if (parsed.protocolVersion !== WORKER_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported worker protocol version: ${String(parsed.protocolVersion)}`,
    );
  }

  if (
    !Array.isArray(parsed.argv) ||
    parsed.argv.some((value) => typeof value !== "string")
  ) {
    throw new Error("Worker request argv must be a string array.");
  }

  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    argv: [...parsed.argv],
  };
}

export function readWorkerRequestFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkerRequestV1 {
  const encoded = env[WORKER_REQUEST_ENV];
  if (!encoded) {
    throw new Error(`Missing ${WORKER_REQUEST_ENV}.`);
  }
  return decodeWorkerRequestV1(encoded);
}
