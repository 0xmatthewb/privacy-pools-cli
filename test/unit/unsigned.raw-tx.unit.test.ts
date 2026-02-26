import { describe, expect, test } from "bun:test";
import { printRawTransactions } from "../../src/utils/unsigned.ts";

describe("raw unsigned tx output", () => {
  test("single transaction includes decimal and hex value encodings", () => {
    const outputs: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => outputs.push(String(line ?? ""));

    try {
      printRawTransactions([
        {
          chainId: 11155111,
          from: null,
          to: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
          value: "100000000000000000",
          data: "0x1234",
          description: "test tx",
        },
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(outputs.length).toBe(1);
    const parsed = JSON.parse(outputs[0]) as {
      to: string;
      data: string;
      value: string;
      valueHex: string;
      chainId: number;
    };
    expect(parsed.to).toBe("0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb");
    expect(parsed.data).toBe("0x1234");
    expect(parsed.value).toBe("100000000000000000");
    expect(parsed.valueHex).toBe("0x16345785d8a0000");
    expect(parsed.chainId).toBe(11155111);
  });

  test("multiple transactions preserve array shape and normalize zero values", () => {
    const outputs: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => outputs.push(String(line ?? ""));

    try {
      printRawTransactions([
        {
          chainId: 1,
          from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
          to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          value: "0",
          data: "0xabcdef",
          description: "approve",
        },
        {
          chainId: 1,
          from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
          to: "0x6818809eefce719e480a7526d76bd3e561526b46",
          value: "123",
          data: "0xdeadbeef",
          description: "deposit",
        },
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(outputs.length).toBe(1);
    const parsed = JSON.parse(outputs[0]) as Array<{
      value: string;
      valueHex: string;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].value).toBe("0");
    expect(parsed[0].valueHex).toBe("0x0");
    expect(parsed[1].value).toBe("123");
    expect(parsed[1].valueHex).toBe("0x7b");
  });
});
