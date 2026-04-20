import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type Address,
} from "viem";

interface RpcAbiSelectorCase {
  signature: string;
  expected4Bytes: string;
}

interface RpcAbiEncodedCallCase {
  signature: string;
  params: string[];
  expectedCalldata: string;
}

interface RpcAbiDecodedResponseCase {
  method: string;
  kind: "string" | "uint256" | "address";
  rawHex: string;
  expectedValue: string;
}

interface RpcAbiFixture {
  selectors: RpcAbiSelectorCase[];
  encodedCalls: RpcAbiEncodedCallCase[];
  decodedResponses: RpcAbiDecodedResponseCase[];
}

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "test/fixtures/rpc-abi-cases.json"),
    "utf8",
  ),
) as RpcAbiFixture;

function decodeFixtureResponse(entry: RpcAbiDecodedResponseCase): string {
  switch (entry.kind) {
    case "string":
      return decodeAbiParameters([{ type: "string" }], entry.rawHex)[0] as string;
    case "uint256":
      return (
        decodeAbiParameters([{ type: "uint256" }], entry.rawHex)[0] as bigint
      ).toString();
    case "address":
      return decodeAbiParameters([{ type: "address" }], entry.rawHex)[0] as Address;
    default: {
      const _exhaustive: never = entry.kind;
      throw new Error(`Unsupported fixture response kind: ${String(_exhaustive)}`);
    }
  }
}

describe("rpc abi parity fixture", () => {
  test("function selectors match the shared fixture", () => {
    for (const entry of fixture.selectors) {
      expect(toFunctionSelector(`function ${entry.signature}`)).toBe(
        entry.expected4Bytes,
      );
    }
  });

  test("encoded calldata matches the shared fixture", () => {
    for (const entry of fixture.encodedCalls) {
      const calldata = encodeFunctionData({
        abi: parseAbi([`function ${entry.signature}`]),
        functionName: entry.signature.slice(0, entry.signature.indexOf("(")),
        args: entry.params as Address[],
      });
      expect(calldata).toBe(entry.expectedCalldata);
    }
  });

  test("decoded responses match the shared fixture", () => {
    for (const entry of fixture.decodedResponses) {
      expect(decodeFixtureResponse(entry)).toBe(entry.expectedValue);
    }
  });
});
