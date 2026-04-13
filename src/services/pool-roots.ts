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
const ROOT_HISTORY_BATCH_CONCURRENCY = 2;
let historicalRootCache = new WeakMap<object, Map<string, Promise<Set<bigint>>>>();
let scopedHistoricalRootCache = new Map<string, Map<string, Promise<Set<bigint>>>>();

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
  cacheScopeKey?: string,
): Map<string, Promise<Set<bigint>>> | null {
  const normalizedScopeKey = cacheScopeKey?.trim();
  if (normalizedScopeKey) {
    let cache = scopedHistoricalRootCache.get(normalizedScopeKey);
    if (!cache) {
      cache = new Map<string, Promise<Set<bigint>>>();
      scopedHistoricalRootCache.set(normalizedScopeKey, cache);
    }
    return cache;
  }

  if (typeof publicClient !== "object" || publicClient === null) {
    return null;
  }

  let cache = historicalRootCache.get(publicClient);
  if (!cache) {
    cache = new Map<string, Promise<Set<bigint>>>();
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
  const batchStarts: number[] = [];

  for (let batchStart = 0; batchStart < rootHistorySize; batchStart += ROOT_HISTORY_BATCH_SIZE) {
    batchStarts.push(batchStart);
  }

  for (
    let groupStart = 0;
    groupStart < batchStarts.length;
    groupStart += ROOT_HISTORY_BATCH_CONCURRENCY
  ) {
    const batchGroup = batchStarts.slice(
      groupStart,
      groupStart + ROOT_HISTORY_BATCH_CONCURRENCY,
    );
    const groupedRoots = await Promise.all(
      batchGroup.map(async (batchStart) => {
        const batchLength = Math.min(
          ROOT_HISTORY_BATCH_SIZE,
          rootHistorySize - batchStart,
        );
        return Promise.all(
          Array.from({ length: batchLength }, (_, offset) =>
            publicClient.readContract({
              address: poolAddress,
              abi: poolRootsAbi,
              functionName: "roots",
              args: [BigInt(batchStart + offset)],
            }),
          ),
        );
      }),
    );

    for (const batchRoots of groupedRoots) {
      for (const knownRoot of batchRoots) {
        knownRoots.add(BigInt(knownRoot as bigint));
      }
    }
  }

  return knownRoots;
}

export function poolRootCacheScopeKey(
  chainId: number,
  rpcOverride?: string,
): string {
  const normalizedRpcOverride = rpcOverride?.trim();
  return `${chainId}:${normalizedRpcOverride && normalizedRpcOverride.length > 0 ? normalizedRpcOverride : "__default__"}`;
}

export function resetPoolRootCacheForTests(): void {
  historicalRootCache = new WeakMap<object, Map<string, Promise<Set<bigint>>>>();
  scopedHistoricalRootCache = new Map<string, Map<string, Promise<Set<bigint>>>>();
}

export async function isKnownPoolRoot(
  publicClient: PoolRootReader,
  poolAddress: Address,
  root: bigint,
  cacheScopeKey?: string,
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

  const cache = getHistoricalRootCache(publicClient, cacheScopeKey);
  const cacheKey = historicalRootCacheKey(poolAddress, currentRoot, rootHistorySize);
  const cachedRoots =
    cache?.get(cacheKey)
    ?? Promise.resolve()
      .then(async () => {
        const historicalRoots = await readHistoricalRoots(
          publicClient,
          poolAddress,
          rootHistorySize,
        );
        historicalRoots.add(currentRoot);
        return historicalRoots;
      });
  if (!cache?.has(cacheKey)) {
    cache?.set(cacheKey, cachedRoots);
  }
  const historicalRoots = await cachedRoots.catch((error) => {
    cache?.delete(cacheKey);
    throw error;
  });
  return historicalRoots.has(root);
}

export async function assertKnownPoolRoot(params: {
  publicClient: PoolRootReader;
  poolAddress: Address;
  proofRoot: bigint;
  message: string;
  hint: string;
  cacheScopeKey?: string;
}): Promise<void> {
  const known = await isKnownPoolRoot(
    params.publicClient,
    params.poolAddress,
    params.proofRoot,
    params.cacheScopeKey,
  );

  if (!known) {
    throw new CLIError(params.message, "ASP", params.hint);
  }
}
