import { describe, expect, test } from "bun:test";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "../../src/runtime/runtime-contract.js";
import {
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
});
