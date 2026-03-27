import { describe, expect, test } from "bun:test";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "../../src/runtime/runtime-contract.js";
import {
  createWorkerRequestV1,
  decodeWorkerRequestV1,
  encodeWorkerRequestV1,
  readWorkerRequestFromEnv,
  WORKER_PROTOCOL_VERSION,
  WORKER_REQUEST_ENV,
} from "../../src/runtime/v1/request.ts";

describe("worker request boundary", () => {
  test("uses the shared runtime contract worker protocol version", () => {
    expect(WORKER_PROTOCOL_VERSION).toBe(
      CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
    );
  });

  test("round-trips WorkerRequestV1 through base64", () => {
    const request = createWorkerRequestV1(["status", "--json"]);
    const encoded = encodeWorkerRequestV1(request);

    expect(decodeWorkerRequestV1(encoded)).toEqual({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      argv: ["status", "--json"],
    });
  });

  test("reads WorkerRequestV1 from env", () => {
    const encoded = encodeWorkerRequestV1(
      createWorkerRequestV1(["guide", "--json"]),
    );

    expect(
      readWorkerRequestFromEnv({
        [WORKER_REQUEST_ENV]: encoded,
      }),
    ).toEqual({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      argv: ["guide", "--json"],
    });
  });

  test("rejects missing, malformed, and unsupported worker requests", () => {
    expect(() => readWorkerRequestFromEnv({})).toThrow(
      `Missing ${WORKER_REQUEST_ENV}.`,
    );
    expect(() => decodeWorkerRequestV1("not-base64")).toThrow(
      "Malformed worker request envelope.",
    );

    const wrongVersion = Buffer.from(
      JSON.stringify({ protocolVersion: "2", argv: [] }),
      "utf8",
    ).toString("base64");
    expect(() => decodeWorkerRequestV1(wrongVersion)).toThrow(
      "Unsupported worker protocol version: 2",
    );
  });
});
