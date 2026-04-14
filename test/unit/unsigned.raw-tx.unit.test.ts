import { describe, expect, test } from "bun:test";
import { printRawTransactions } from "../../src/utils/unsigned.ts";

function captureStdout(run: () => void): string {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

describe("raw unsigned tx output", () => {
  test("single transaction includes decimal and hex value encodings", () => {
    const output = captureStdout(() => {
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
    });

    const parsed = JSON.parse(output.trim()) as Array<{
      to: string;
      data: string;
      value: string;
      valueHex: string;
      chainId: number;
      description: string;
    }>;
    // Always emits as array (even for single tx)
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].to).toBe("0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb");
    expect(parsed[0].data).toBe("0x1234");
    expect(parsed[0].value).toBe("100000000000000000");
    expect(parsed[0].valueHex).toBe("0x16345785d8a0000");
    expect(parsed[0].chainId).toBe(11155111);
    expect(parsed[0].description).toBe("test tx");
  });

  test("preserves explicit from addresses and terminates output with a newline", () => {
    const output = captureStdout(() => {
      printRawTransactions([
        {
          chainId: 1,
          from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
          to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          value: "42",
          data: "0xabcdef",
          description: "approve",
        },
      ]);
    });

    expect(output.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(output.trim()) as Array<{ from: string | null }>;
    expect(parsed[0]?.from).toBe("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A");
  });

  test("multiple transactions preserve array shape and normalize zero values", () => {
    const output = captureStdout(() => {
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
    });

    const parsed = JSON.parse(output.trim()) as Array<{
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
