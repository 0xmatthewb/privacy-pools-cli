import type { Address } from "viem";
import { CLIError } from "../utils/errors.js";

const poolCurrentRootAbi = [
  {
    name: "currentRoot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const poolRootsAbi = [
  {
    name: "roots",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const poolRootHistorySizeAbi = [
  {
    name: "ROOT_HISTORY_SIZE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
] as const;

const ROOT_HISTORY_SCAN_CAP = 64;
const ROOT_HISTORY_BATCH_SIZE = 8;
let historicalRootCache = new WeakMap<object, Map<string, Set<bigint>>>();

interface PoolRootReader {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

function getHistoricalRootCache(
  publicClient: PoolRootReader,
): Map<string, Set<bigint>> | null {
  if (typeof publicClient !== "object" || publicClient === null) {
    return null;
  }

  let cache = historicalRootCache.get(publicClient);
  if (!cache) {
    cache = new Map<string, Set<bigint>>();
    historicalRootCache.set(publicClient, cache);
  }
  return cache;
}

function historicalRootCacheKey(
  poolAddress: Address,
  currentRoot: bigint,
  rootHistorySize: number,
): string {
  return `${poolAddress.toLowerCase()}:${currentRoot.toString()}:${rootHistorySize}`;
}

async function readHistoricalRoots(
  publicClient: PoolRootReader,
  poolAddress: Address,
  rootHistorySize: number,
): Promise<Set<bigint>> {
  const knownRoots = new Set<bigint>();

  for (
    let batchStart = 0;
    batchStart < rootHistorySize;
    batchStart += ROOT_HISTORY_BATCH_SIZE
  ) {
    const batchLength = Math.min(
      ROOT_HISTORY_BATCH_SIZE,
      rootHistorySize - batchStart,
    );
    const batchRoots = await Promise.all(
      Array.from({ length: batchLength }, (_, offset) =>
        publicClient.readContract({
          address: poolAddress,
          abi: poolRootsAbi,
          functionName: "roots",
          args: [BigInt(batchStart + offset)],
        }),
      ),
    );

    for (const knownRoot of batchRoots) {
      knownRoots.add(BigInt(knownRoot as bigint));
    }
  }

  return knownRoots;
}

export function resetPoolRootCacheForTests(): void {
  historicalRootCache = new WeakMap<object, Map<string, Set<bigint>>>();
}

export async function isKnownPoolRoot(
  publicClient: PoolRootReader,
  poolAddress: Address,
  root: bigint,
): Promise<boolean> {
  if (root === 0n) {
    return false;
  }

  const [currentRootResult, rootHistorySizeResult] = await Promise.all([
    publicClient.readContract({
      address: poolAddress,
      abi: poolCurrentRootAbi,
      functionName: "currentRoot",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: poolRootHistorySizeAbi,
      functionName: "ROOT_HISTORY_SIZE",
    }),
  ]);
  const currentRoot = BigInt(currentRootResult as bigint);

  if (currentRoot === root) {
    return true;
  }

  const rootHistorySize = Math.min(
    Number(rootHistorySizeResult),
    ROOT_HISTORY_SCAN_CAP,
  );
  if (rootHistorySize <= 0) {
    return false;
  }

  const cache = getHistoricalRootCache(publicClient);
  const cacheKey = historicalRootCacheKey(poolAddress, currentRoot, rootHistorySize);
  const cachedRoots = cache?.get(cacheKey);
  if (cachedRoots) {
    return cachedRoots.has(root);
  }

  const historicalRoots = await readHistoricalRoots(
    publicClient,
    poolAddress,
    rootHistorySize,
  );
  historicalRoots.add(currentRoot);
  cache?.set(cacheKey, historicalRoots);
  return historicalRoots.has(root);
}

export async function assertKnownPoolRoot(params: {
  publicClient: PoolRootReader;
  poolAddress: Address;
  proofRoot: bigint;
  message: string;
  hint: string;
}): Promise<void> {
  const known = await isKnownPoolRoot(
    params.publicClient,
    params.poolAddress,
    params.proofRoot,
  );

  if (!known) {
    throw new CLIError(params.message, "ASP", params.hint);
  }
}
