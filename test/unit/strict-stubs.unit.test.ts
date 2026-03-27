import { describe, expect, test } from "bun:test";
import { createStrictStubRegistry } from "../helpers/strict-stubs.ts";

describe("strict stub registry", () => {
  test("consumes expected calls in order and records call labels", () => {
    const registry = createStrictStubRegistry<[string], string>("rpc");
    registry.expectCall("first", (method) => `${method}:ok`, {
      match: (method) => method === "eth_chainId",
    });
    registry.expectCall("second", (method) => `${method}:ok`, {
      match: (method) => method === "eth_blockNumber",
    });

    const stub = registry.createStub();

    expect(stub("eth_chainId")).toBe("eth_chainId:ok");
    expect(stub("eth_blockNumber")).toBe("eth_blockNumber:ok");
    expect(registry.calls.map((call) => call.label)).toEqual([
      "first",
      "second",
    ]);
    registry.assertConsumed();
  });

  test("fails fast on unexpected calls", () => {
    const registry = createStrictStubRegistry<[string], string>("asp");
    registry.expectCall("status", () => "ok", {
      match: (path) => path === "/status",
    });

    const stub = registry.createStub();

    expect(() => stub("/unexpected")).toThrow("[asp] unexpected call");
  });

  test("surfaces unused expectations at teardown", () => {
    const registry = createStrictStubRegistry<[string], string>("relayer");
    registry.expectCall("quote", () => "ok");

    expect(() => registry.assertConsumed()).toThrow("unused expectations");
  });
});
