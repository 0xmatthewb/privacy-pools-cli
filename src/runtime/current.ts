import { fileURLToPath } from "node:url";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "./runtime-contract.js";
import {
  createWorkerRequestV1,
  decodeWorkerRequestV1,
  encodeWorkerRequestV1,
  WORKER_REQUEST_ENV,
  type WorkerRequestV1,
} from "./v1/request.js";

export interface NativeJsBridgeDescriptor {
  runtimeVersion: string;
  workerProtocolVersion: string;
  workerRequestEnv: string;
  workerCommand: string;
  workerArgs: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const NATIVE_JS_BRIDGE_ENV = "PRIVACY_POOLS_INTERNAL_JS_BRIDGE_B64";
export const CURRENT_RUNTIME_REQUEST_ENV = WORKER_REQUEST_ENV;

export function resolveCurrentWorkerPath(): string {
  return fileURLToPath(
    new URL(CURRENT_RUNTIME_DESCRIPTOR.workerEntryRelativePath, import.meta.url),
  );
}

export function createCurrentWorkerRequest(argv: string[]): WorkerRequestV1 {
  return createWorkerRequestV1(argv);
}

export function encodeCurrentWorkerRequest(argv: string[]): string {
  return encodeWorkerRequestV1(createCurrentWorkerRequest(argv));
}

export function decodeCurrentWorkerRequest(encoded: string): WorkerRequestV1 {
  return decodeWorkerRequestV1(encoded);
}

export function createNativeJsBridgeDescriptor(
  workerCommand: string,
  workerArgs: string[],
): NativeJsBridgeDescriptor {
  return {
    runtimeVersion: CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
    workerProtocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
    workerRequestEnv: CURRENT_RUNTIME_REQUEST_ENV,
    workerCommand,
    workerArgs: [...workerArgs],
  };
}

export function encodeNativeJsBridgeDescriptor(
  descriptor: NativeJsBridgeDescriptor,
): string {
  return Buffer.from(JSON.stringify(descriptor), "utf8").toString("base64");
}

export function decodeNativeJsBridgeDescriptor(
  encoded: string,
): NativeJsBridgeDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Malformed JS bridge descriptor.");
  }

  if (!isPlainObject(parsed)) {
    throw new Error("JS bridge descriptor must be an object.");
  }

  if (
    typeof parsed.runtimeVersion !== "string" ||
    !parsed.runtimeVersion.trim()
  ) {
    throw new Error("JS bridge descriptor runtimeVersion must be a string.");
  }

  if (
    typeof parsed.workerProtocolVersion !== "string" ||
    !parsed.workerProtocolVersion.trim()
  ) {
    throw new Error(
      "JS bridge descriptor workerProtocolVersion must be a string.",
    );
  }

  if (
    typeof parsed.workerRequestEnv !== "string" ||
    !parsed.workerRequestEnv.trim()
  ) {
    throw new Error("JS bridge descriptor workerRequestEnv must be a string.");
  }

  if (
    typeof parsed.workerCommand !== "string" ||
    !parsed.workerCommand.trim()
  ) {
    throw new Error("JS bridge descriptor workerCommand must be a string.");
  }

  if (
    !Array.isArray(parsed.workerArgs) ||
    parsed.workerArgs.some((value) => typeof value !== "string")
  ) {
    throw new Error("JS bridge descriptor workerArgs must be a string array.");
  }

  return {
    runtimeVersion: parsed.runtimeVersion,
    workerProtocolVersion: parsed.workerProtocolVersion,
    workerRequestEnv: parsed.workerRequestEnv,
    workerCommand: parsed.workerCommand,
    workerArgs: [...parsed.workerArgs],
  };
}
