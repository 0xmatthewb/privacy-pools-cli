import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { isKnownPoolRoot } from "../../src/services/pool-roots.ts";

describe("pool roots service", () => {
  const poolAddress = "0x0000000000000000000000000000000000000001" as Address;

  test("rejects zero root even when currentRoot is zero", async () => {
    let readCount = 0;
    const publicClient = {
      async readContract() {
        readCount += 1;
        return 0n;
      },
    };

    await expect(
      isKnownPoolRoot(publicClient, poolAddress, 0n),
    ).resolves.toBe(false);
    expect(readCount).toBe(0);
  });

  test("accepts a historical cached root", async () => {
    const historicalRoot = 42n;
    const publicClient = {
      async readContract(args: { functionName: string; args?: readonly unknown[] }) {
        if (args.functionName === "currentRoot") {
          return 7n;
        }
        if (args.functionName === "ROOT_HISTORY_SIZE") {
          return 64;
        }
        if (args.functionName === "roots") {
          const index = Number(args.args?.[0] ?? -1);
          return index === 12 ? historicalRoot : 0n;
        }
        throw new Error(`unexpected function ${args.functionName}`);
      },
    };

    await expect(
      isKnownPoolRoot(publicClient, poolAddress, historicalRoot),
    ).resolves.toBe(true);
  });
});
