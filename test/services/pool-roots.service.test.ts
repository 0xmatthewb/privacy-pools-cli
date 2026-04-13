import { afterEach, describe, expect, test } from "bun:test";
import type { Address } from "viem";
import {
  isKnownPoolRoot,
  resetPoolRootCacheForTests,
} from "../../src/services/pool-roots.ts";

describe("pool roots service", () => {
  const poolAddress = "0x0000000000000000000000000000000000000001" as Address;

  afterEach(() => {
    resetPoolRootCacheForTests();
  });

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

  test("accepts currentRoot without scanning historical roots", async () => {
    let rootsReads = 0;
    const currentRoot = 77n;
    const publicClient = {
      async readContract(args: { functionName: string }) {
        if (args.functionName === "currentRoot") {
          return currentRoot;
        }
        if (args.functionName === "ROOT_HISTORY_SIZE") {
          return 64;
        }
        if (args.functionName === "roots") {
          rootsReads += 1;
          return 0n;
        }
        throw new Error(`unexpected function ${args.functionName}`);
      },
    };

    await expect(
      isKnownPoolRoot(publicClient, poolAddress, currentRoot),
    ).resolves.toBe(true);
    expect(rootsReads).toBe(0);
  });

  test("rejects unknown non-zero roots", async () => {
    const unknownRoot = 999n;
    const publicClient = {
      async readContract(args: { functionName: string; args?: readonly unknown[] }) {
        if (args.functionName === "currentRoot") {
          return 7n;
        }
        if (args.functionName === "ROOT_HISTORY_SIZE") {
          return 4;
        }
        if (args.functionName === "roots") {
          return 0n;
        }
        throw new Error(`unexpected function ${args.functionName}`);
      },
    };

    await expect(
      isKnownPoolRoot(publicClient, poolAddress, unknownRoot),
    ).resolves.toBe(false);
  });

  test("honors the onchain ROOT_HISTORY_SIZE instead of assuming 64", async () => {
    const historicalRoot = 123n;
    const rootsIndices: number[] = [];
    const publicClient = {
      async readContract(args: { functionName: string; args?: readonly unknown[] }) {
        if (args.functionName === "currentRoot") {
          return 7n;
        }
        if (args.functionName === "ROOT_HISTORY_SIZE") {
          return 3;
        }
        if (args.functionName === "roots") {
          const index = Number(args.args?.[0] ?? -1);
          rootsIndices.push(index);
          return index === 2 ? historicalRoot : 0n;
        }
        throw new Error(`unexpected function ${args.functionName}`);
      },
    };

    await expect(
      isKnownPoolRoot(publicClient, poolAddress, historicalRoot),
    ).resolves.toBe(true);
    expect(rootsIndices).toEqual([0, 1, 2]);
  });

  test("reuses the cached root history window for repeated checks on the same client", async () => {
    const historicalRoot = 42n;
    let rootsReads = 0;
    const publicClient = {
      async readContract(args: { functionName: string; args?: readonly unknown[] }) {
        if (args.functionName === "currentRoot") {
          return 7n;
        }
        if (args.functionName === "ROOT_HISTORY_SIZE") {
          return 4;
        }
        if (args.functionName === "roots") {
          rootsReads += 1;
          const index = Number(args.args?.[0] ?? -1);
          return index === 2 ? historicalRoot : 0n;
        }
        throw new Error(`unexpected function ${args.functionName}`);
      },
    };

    await expect(
      isKnownPoolRoot(publicClient, poolAddress, historicalRoot),
    ).resolves.toBe(true);
    await expect(
      isKnownPoolRoot(publicClient, poolAddress, historicalRoot),
    ).resolves.toBe(true);

    expect(rootsReads).toBe(4);
  });

  test("dedupes concurrent cold-miss root scans for the same client and pool", async () => {
    const historicalRoot = 42n;
    let rootsReads = 0;
    const publicClient = {
      async readContract(args: { functionName: string; args?: readonly unknown[] }) {
        if (args.functionName === "currentRoot") {
          return 7n;
        }
        if (args.functionName === "ROOT_HISTORY_SIZE") {
          return 4;
        }
        if (args.functionName === "roots") {
          rootsReads += 1;
          await Bun.sleep(5);
          const index = Number(args.args?.[0] ?? -1);
          return index === 2 ? historicalRoot : 0n;
        }
        throw new Error(`unexpected function ${args.functionName}`);
      },
    };

    const [first, second] = await Promise.all([
      isKnownPoolRoot(publicClient, poolAddress, historicalRoot),
      isKnownPoolRoot(publicClient, poolAddress, historicalRoot),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(rootsReads).toBe(4);
  });
});
