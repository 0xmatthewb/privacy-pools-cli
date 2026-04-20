import { describe, expect, test } from "bun:test";
import {
  CURRENT_NATIVE_JS_BRIDGE_ENV,
  CURRENT_RUNTIME_DESCRIPTOR,
  CURRENT_RUNTIME_REQUEST_ENV,
} from "../../src/runtime/runtime-contract.js";
import {
  createCurrentWorkerRequest,
  decodeCurrentWorkerRequest,
  encodeCurrentWorkerRequest,
  createNativeJsBridgeDescriptor,
  decodeNativeJsBridgeDescriptor,
  encodeNativeJsBridgeDescriptor,
  resolveCurrentWorkerPath,
} from "../../src/runtime/current.ts";

describe("current runtime contract", () => {
  test("resolves the active worker entrypoint from the shared descriptor", () => {
    expect(resolveCurrentWorkerPath()).toContain(
      CURRENT_RUNTIME_DESCRIPTOR.workerEntryRelativePath.replace("./", ""),
    );
  });

  test("round-trips the native JS bridge descriptor", () => {
    const descriptor = createNativeJsBridgeDescriptor(process.execPath, [
      resolveCurrentWorkerPath(),
    ]);

    expect(
      decodeNativeJsBridgeDescriptor(encodeNativeJsBridgeDescriptor(descriptor)),
    ).toEqual(descriptor);
  });

  test("round-trips the current worker request helpers", () => {
    const argv = ["status", "--agent"];

    expect(createCurrentWorkerRequest(argv)).toMatchObject({
      protocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
      argv,
    });
    expect(
      decodeCurrentWorkerRequest(encodeCurrentWorkerRequest(argv)),
    ).toMatchObject({
      protocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
      argv,
    });
  });

  test("rejects malformed or invalid native bridge descriptors", () => {
    expect(() => decodeNativeJsBridgeDescriptor("%%%")).toThrow(
      "Malformed JS bridge descriptor.",
    );
    expect(() =>
      decodeNativeJsBridgeDescriptor(
        Buffer.from(JSON.stringify(["not-an-object"]), "utf8").toString("base64"),
      ),
    ).toThrow("JS bridge descriptor must be an object.");
    expect(() =>
      decodeNativeJsBridgeDescriptor(
        Buffer.from(
          JSON.stringify({
            runtimeVersion: "",
            workerProtocolVersion: "1",
            nativeBridgeVersion: "1",
            workerRequestEnv: "PP_WORKER_REQUEST",
            workerCommand: process.execPath,
            workerArgs: [],
          }),
          "utf8",
        ).toString("base64"),
      ),
    ).toThrow("runtimeVersion must be a string.");
    expect(() =>
      decodeNativeJsBridgeDescriptor(
        Buffer.from(
          JSON.stringify({
            runtimeVersion: "1",
            workerProtocolVersion: "1",
            nativeBridgeVersion: "1",
            workerRequestEnv: "PP_WORKER_REQUEST",
            workerCommand: process.execPath,
            workerArgs: [123],
          }),
          "utf8",
        ).toString("base64"),
      ),
    ).toThrow("workerArgs must be a string array.");
  });

  test("rejects bridge descriptors with missing required string fields", () => {
    const baseDescriptor = {
      runtimeVersion: "1",
      workerProtocolVersion: "1",
      nativeBridgeVersion: "1",
      workerRequestEnv: "PP_WORKER_REQUEST",
      workerCommand: process.execPath,
      workerArgs: [],
    };

    expect(() =>
      decodeNativeJsBridgeDescriptor(
        Buffer.from(
          JSON.stringify({
            ...baseDescriptor,
            workerProtocolVersion: "",
          }),
          "utf8",
        ).toString("base64"),
      ),
    ).toThrow("workerProtocolVersion must be a string.");

    expect(() =>
      decodeNativeJsBridgeDescriptor(
        Buffer.from(
          JSON.stringify({
            ...baseDescriptor,
            nativeBridgeVersion: "",
          }),
          "utf8",
        ).toString("base64"),
      ),
    ).toThrow("nativeBridgeVersion must be a string.");

    expect(() =>
      decodeNativeJsBridgeDescriptor(
        Buffer.from(
          JSON.stringify({
            ...baseDescriptor,
            workerRequestEnv: "",
          }),
          "utf8",
        ).toString("base64"),
      ),
    ).toThrow("workerRequestEnv must be a string.");

    expect(() =>
      decodeNativeJsBridgeDescriptor(
        Buffer.from(
          JSON.stringify({
            ...baseDescriptor,
            workerCommand: "",
          }),
          "utf8",
        ).toString("base64"),
      ),
    ).toThrow("workerCommand must be a string.");
  });

  test("publishes runtime env names through the shared descriptor", () => {
    expect(CURRENT_RUNTIME_DESCRIPTOR.workerRequestEnv).toBe(
      CURRENT_RUNTIME_REQUEST_ENV,
    );
    expect(CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeEnv).toBe(
      CURRENT_NATIVE_JS_BRIDGE_ENV,
    );
  });
});
