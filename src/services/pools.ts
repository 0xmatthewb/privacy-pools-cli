import type { Address, PublicClient } from "viem";
import { erc20Abi, parseAbi } from "viem";
import type { ChainConfig, PoolStats } from "../types.js";
import { NATIVE_ASSET_ADDRESS, KNOWN_POOLS } from "../config/chains.js";
import { resolvePoolDeploymentBlock } from "../config/deployment-hints.js";
import { fetchPoolsStats, type PoolStatsEntry } from "./asp.js";
import {
  getPublicClient,
  getReadOnlyRpcSession,
  type ReadOnlyRpcSession,
} from "./sdk.js";
import { hasCustomRpcOverride } from "./config.js";
import { CLIError, sanitizeEndpointForDisplay } from "../utils/errors.js";
import {
  elapsedRuntimeMs,
  emitRuntimeDiagnostic,
  runtimeStopwatch,
} from "../runtime/diagnostics.js";

// Entrypoint ABI fragment for read-only calls
const entrypointAbi = parseAbi([
  "function assetConfig(address asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)",
]);

// Pool contract ABI fragment - SCOPE() is on the pool, not the entrypoint
const poolAbi = parseAbi([
  "function SCOPE() view returns (uint256)",
]);

// Cache token metadata to avoid repeated on-chain calls
const tokenCache = new Map<string, { symbol: string; decimals: number }>();
const resolvedPoolCache = new Map<string, Promise<PoolStats>>();
const disabledReadOnlyMulticallCache = new Set<string>();

type ReadOnlyRunRead = ReadOnlyRpcSession["runRead"];
type AssetConfigReadResult = {
  pool: Address;
  minimumDepositAmount: bigint;
  vettingFeeBPS: bigint;
  maxRelayFeeBPS: bigint;
};
type TokenMetadata = { symbol: string; decimals: number };
type ResolveTokenMetadataOptions = {
  allowFallback?: boolean;
  rpcCacheKey?: string;
};
type ResolveTokenMetadataResult = {
  tokenMeta: TokenMetadata;
  usedFallback: boolean;
};
type ResolveReadOnlyPoolDescriptorOptions = {
  allowTokenMetadataFallback?: boolean;
};

function tokenCacheKey(
  chainId: number,
  rpcCacheKey: string | undefined,
  assetAddress: Address,
): string {
  return `${chainId}:${rpcCacheKey ?? "__default_rpc__"}:${assetAddress.toLowerCase()}`;
}

function readOnlyMulticallCacheKey(chainId: number, rpcUrl: string): string {
  return `${chainId}:${rpcUrl}`;
}

function isNativeAssetAddress(assetAddress: Address): boolean {
  return assetAddress.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase();
}

function isReadOnlyMulticallEnabled(
  chainConfig: ChainConfig,
  rpcSession: ReadOnlyRpcSession,
): boolean {
  if (!chainConfig.multicall3Address) {
    return false;
  }

  return !disabledReadOnlyMulticallCache.has(
    readOnlyMulticallCacheKey(chainConfig.id, rpcSession.rpcUrl),
  );
}

function disableReadOnlyMulticall(
  chainConfig: ChainConfig,
  rpcSession: ReadOnlyRpcSession,
): void {
  disabledReadOnlyMulticallCache.add(
    readOnlyMulticallCacheKey(chainConfig.id, rpcSession.rpcUrl),
  );
}

function isRpcLikeError(error: unknown): boolean {
  if (error instanceof CLIError) {
    return error.category === "RPC";
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("fetch") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("timeout") ||
    message.includes("network")
  );
}

function resolvePoolAssetAddress(entry: Record<string, unknown>): Address | null {
  const assetAddress =
    typeof entry.assetAddress === "string"
      ? entry.assetAddress.trim()
      : typeof entry.tokenAddress === "string"
        ? entry.tokenAddress.trim()
        : null;

  if (!assetAddress || !/^0x[0-9a-fA-F]{40}$/.test(assetAddress)) {
    return null;
  }

  return assetAddress as Address;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOptionalBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (
    typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
  ) {
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      try {
        return BigInt(trimmed);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

type PoolStatsMetrics = Pick<
  PoolStats,
  | "totalInPoolValue"
  | "totalInPoolValueUsd"
  | "totalDepositsValue"
  | "totalDepositsValueUsd"
  | "acceptedDepositsValue"
  | "acceptedDepositsValueUsd"
  | "pendingDepositsValue"
  | "pendingDepositsValueUsd"
  | "totalDepositsCount"
  | "acceptedDepositsCount"
  | "pendingDepositsCount"
  | "growth24h"
  | "pendingGrowth24h"
>;

function parsePoolStatsEntry(entry: Record<string, unknown>): PoolStatsMetrics {
  const growth24h =
    entry.growth24h === null ? null : parseOptionalNumber(entry.growth24h);
  const pendingGrowth24h =
    entry.pendingGrowth24h === null ? null : parseOptionalNumber(entry.pendingGrowth24h);

  return {
    totalInPoolValue: parseOptionalBigInt(entry.totalInPoolValue),
    totalInPoolValueUsd:
      typeof entry.totalInPoolValueUsd === "string"
        ? entry.totalInPoolValueUsd
        : undefined,
    totalDepositsValue: parseOptionalBigInt(entry.totalDepositsValue),
    totalDepositsValueUsd:
      typeof entry.totalDepositsValueUsd === "string"
        ? entry.totalDepositsValueUsd
        : undefined,
    acceptedDepositsValue: parseOptionalBigInt(entry.acceptedDepositsValue),
    acceptedDepositsValueUsd:
      typeof entry.acceptedDepositsValueUsd === "string"
        ? entry.acceptedDepositsValueUsd
        : undefined,
    pendingDepositsValue: parseOptionalBigInt(entry.pendingDepositsValue),
    pendingDepositsValueUsd:
      typeof entry.pendingDepositsValueUsd === "string"
        ? entry.pendingDepositsValueUsd
        : undefined,
    totalDepositsCount: parseOptionalNumber(entry.totalDepositsCount),
    acceptedDepositsCount: parseOptionalNumber(entry.acceptedDepositsCount),
    pendingDepositsCount: parseOptionalNumber(entry.pendingDepositsCount),
    growth24h: growth24h ?? undefined,
    pendingGrowth24h: pendingGrowth24h ?? undefined,
  };
}

function normalizeStatsEntries(
  statsData: unknown
): PoolStatsEntry[] {
  if (Array.isArray(statsData)) {
    return statsData.filter(isRecord) as PoolStatsEntry[];
  }

  if (!isRecord(statsData)) {
    return [];
  }

  const directPools = Array.isArray(statsData.pools)
    ? statsData.pools.filter(isRecord)
    : [];

  if (directPools.length > 0) {
    return directPools as PoolStatsEntry[];
  }

  return Object.entries(statsData)
    .filter(([key, value]) => key !== "pools" && isRecord(value))
    .map(([, value]) => value as PoolStatsEntry);
}

export async function resolveTokenMetadata(
  publicClient: PublicClient,
  assetAddress: Address,
  runRead?: ReadOnlyRunRead,
  options?: ResolveTokenMetadataOptions,
): Promise<TokenMetadata> {
  const result = await resolveTokenMetadataResult(
    publicClient,
    assetAddress,
    runRead,
    options,
  );
  return result.tokenMeta;
}

async function resolveTokenMetadataResult(
  publicClient: PublicClient,
  assetAddress: Address,
  runRead?: ReadOnlyRunRead,
  options: ResolveTokenMetadataOptions = {},
): Promise<ResolveTokenMetadataResult> {
  const startedAt = runtimeStopwatch();
  const allowFallback = options.allowFallback ?? false;
  const cacheKey = tokenCacheKey(
    publicClient.chain?.id ?? 0,
    options.rpcCacheKey,
    assetAddress,
  );
  const cached = tokenCache.get(cacheKey);
  if (cached) {
    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "token-metadata-cache",
      asset: assetAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "cache-hit",
    });
    return {
      tokenMeta: cached,
      usedFallback: false,
    };
  }

  if (isNativeAssetAddress(assetAddress)) {
    const result = { symbol: "ETH", decimals: 18 };
    tokenCache.set(cacheKey, result);
    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "token-metadata-native",
      asset: assetAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "ok",
    });
    return {
      tokenMeta: result,
      usedFallback: false,
    };
  }

  try {
    const read = runRead ?? ((_: string, loader: () => Promise<{ symbol: string; decimals: number }>) => loader());
    const result = await read(`token-metadata:${cacheKey}`, async () => {
      const [symbol, decimals] = await Promise.all([
        publicClient.readContract({
          address: assetAddress,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: assetAddress,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);

      return { symbol: symbol as string, decimals: decimals as number };
    });
    tokenCache.set(cacheKey, result);
    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "token-metadata",
      asset: assetAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "ok",
    });
    return {
      tokenMeta: result,
      usedFallback: false,
    };
  } catch {
    // Fallback is intentionally not cached so transient RPC failures
    // or partial test doubles do not poison later successful reads.
    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "token-metadata",
      asset: assetAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: allowFallback ? "fallback" : "error",
    });
    if (allowFallback) {
      return {
        tokenMeta: { symbol: "???", decimals: 18 },
        usedFallback: true,
      };
    }

    throw new CLIError(
      `Failed to resolve ERC-20 metadata for ${assetAddress} on ${publicClient.chain?.name ?? `chain ${publicClient.chain?.id ?? "unknown"}`}.`,
      "RPC",
      "Check your RPC URL and network connectivity, then retry.",
      "RPC_POOL_RESOLUTION_FAILED",
      true,
    );
  }
}

async function resolveReadOnlyPoolMetadataViaMulticall(
  chainConfig: ChainConfig,
  rpcSession: ReadOnlyRpcSession,
  assetAddress: Address,
): Promise<{
  assetConfig: AssetConfigReadResult;
  tokenMeta: TokenMetadata;
}> {
  const startedAt = runtimeStopwatch();
  const publicClient = rpcSession.publicClient;
  const usesNativeMetadata = isNativeAssetAddress(assetAddress);
  const contracts: Array<{
    address: Address;
    abi: unknown;
    functionName: string;
    args?: readonly Address[];
  }> = [
    {
      address: chainConfig.entrypoint,
      abi: entrypointAbi,
      functionName: "assetConfig",
      args: [assetAddress],
    },
  ];

  if (!usesNativeMetadata) {
    contracts.push(
      {
        address: assetAddress,
        abi: erc20Abi,
        functionName: "symbol",
      },
      {
        address: assetAddress,
        abi: erc20Abi,
        functionName: "decimals",
      },
    );
  }

  const results = await (publicClient as typeof publicClient & {
    multicall(args: unknown): Promise<unknown[]>;
  }).multicall({
    allowFailure: false,
    multicallAddress: chainConfig.multicall3Address,
    contracts,
  });

  const [assetConfigResult, symbolResult, decimalsResult] = results;
  const [pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS] =
    assetConfigResult as [Address, bigint, bigint, bigint];
  const tokenMeta = usesNativeMetadata
    ? { symbol: "ETH", decimals: 18 }
    : {
        symbol: symbolResult as string,
        decimals:
          typeof decimalsResult === "number"
            ? decimalsResult
            : Number(decimalsResult),
      };

  tokenCache.set(
    tokenCacheKey(
      publicClient.chain?.id ?? 0,
      rpcSession.rpcUrl,
      assetAddress,
    ),
    tokenMeta,
  );
  emitRuntimeDiagnostic("rpc-latency", {
    chainId: publicClient.chain?.id ?? 0,
    operation: "pool-metadata-multicall",
    asset: assetAddress,
    elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
    outcome: "ok",
  });

  return {
    assetConfig: {
      pool,
      minimumDepositAmount,
      vettingFeeBPS,
      maxRelayFeeBPS,
    },
    tokenMeta,
  };
}

/**
 * Read-only on-chain asset config lookup (no private key needed)
 */
async function getAssetConfigReadOnly(
  publicClient: PublicClient,
  entrypoint: Address,
  assetAddress: Address,
  runRead?: ReadOnlyRunRead,
): Promise<{
  pool: Address;
  minimumDepositAmount: bigint;
  vettingFeeBPS: bigint;
  maxRelayFeeBPS: bigint;
}> {
  const startedAt = runtimeStopwatch();
  try {
    const read = runRead ?? ((_: string, loader: () => Promise<unknown>) => loader());
    const result = await read(
      `asset-config:${publicClient.chain?.id ?? 0}:${entrypoint.toLowerCase()}:${assetAddress.toLowerCase()}`,
      () => publicClient.readContract({
        address: entrypoint,
        abi: entrypointAbi,
        functionName: "assetConfig",
        args: [assetAddress],
      }),
    );

    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "asset-config",
      asset: assetAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "ok",
    });

    const [pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS] = result as [Address, bigint, bigint, bigint];
    return { pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS };
  } catch (error) {
    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "asset-config",
      asset: assetAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "error",
      errorCategory: error instanceof CLIError ? error.category : undefined,
    });
    throw error;
  }
}

/**
 * Read-only on-chain scope lookup - calls SCOPE() on the pool contract itself
 */
async function getScopeReadOnly(
  publicClient: PublicClient,
  poolAddress: Address,
  runRead?: ReadOnlyRunRead,
): Promise<bigint> {
  const startedAt = runtimeStopwatch();
  try {
    const read = runRead ?? ((_: string, loader: () => Promise<unknown>) => loader());
    const scope = await read(
      `pool-scope:${publicClient.chain?.id ?? 0}:${poolAddress.toLowerCase()}`,
      () => publicClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "SCOPE",
      }),
    ) as bigint;
    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "pool-scope",
      pool: poolAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "ok",
    });
    return scope;
  } catch (error) {
    emitRuntimeDiagnostic("rpc-latency", {
      chainId: publicClient.chain?.id ?? 0,
      operation: "pool-scope",
      pool: poolAddress,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "error",
      errorCategory: error instanceof CLIError ? error.category : undefined,
    });
    throw error;
  }
}

async function resolveRuntimeDeploymentBlock(
  chainConfig: ChainConfig,
  _rpcOverride: string | undefined,
  ...addresses: Array<string | null | undefined>
): Promise<bigint> {
  return resolvePoolDeploymentBlock(
    chainConfig.id,
    chainConfig.startBlock,
    ...addresses,
  );
}

function resolvedPoolCacheKey(
  chainId: number,
  rpcUrl: string,
  assetAddress: Address,
  allowTokenMetadataFallback: boolean,
): string {
  return `${chainId}:${rpcUrl}:${assetAddress.toLowerCase()}:${allowTokenMetadataFallback ? "metadata-fallback-ok" : "metadata-strict"}`;
}

export function resetPoolsServiceCachesForTests(): void {
  tokenCache.clear();
  resolvedPoolCache.clear();
  disabledReadOnlyMulticallCache.clear();
}

async function resolveReadOnlyPoolDescriptor(
  chainConfig: ChainConfig,
  rpcSession: ReadOnlyRpcSession,
  assetAddress: Address,
  rpcOverride?: string,
  options: ResolveReadOnlyPoolDescriptorOptions = {},
): Promise<PoolStats> {
  const allowTokenMetadataFallback = options.allowTokenMetadataFallback ?? false;
  const cacheKey = resolvedPoolCacheKey(
    chainConfig.id,
    rpcSession.rpcUrl,
    assetAddress,
    allowTokenMetadataFallback,
  );
  const cached = resolvedPoolCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let persistResolvedDescriptor = true;
  const poolPromise = (async () => {
    const publicClient = rpcSession.publicClient;
    let assetConfig: AssetConfigReadResult;
    let tokenMeta: TokenMetadata;
    let tokenMetadataUsedFallback = false;

    if (isReadOnlyMulticallEnabled(chainConfig, rpcSession)) {
      const multicallStartedAt = runtimeStopwatch();
      try {
        ({ assetConfig, tokenMeta } = await resolveReadOnlyPoolMetadataViaMulticall(
          chainConfig,
          rpcSession,
          assetAddress,
        ));
      } catch (error) {
        emitRuntimeDiagnostic("rpc-latency", {
          chainId: publicClient.chain?.id ?? 0,
          operation: "pool-metadata-multicall",
          asset: assetAddress,
          elapsedMs: elapsedRuntimeMs(multicallStartedAt).toFixed(2),
          outcome: "fallback",
          errorCategory: error instanceof CLIError ? error.category : undefined,
        });
        disableReadOnlyMulticall(chainConfig, rpcSession);
        const [resolvedAssetConfig, tokenMetaResult] = await Promise.all([
          getAssetConfigReadOnly(
            publicClient,
            chainConfig.entrypoint,
            assetAddress,
            rpcSession.runRead,
          ),
          resolveTokenMetadataResult(
            publicClient,
            assetAddress,
            rpcSession.runRead,
            {
              allowFallback: allowTokenMetadataFallback,
              rpcCacheKey: rpcSession.rpcUrl,
            },
          ),
        ]);
        assetConfig = resolvedAssetConfig;
        tokenMeta = tokenMetaResult.tokenMeta;
        tokenMetadataUsedFallback = tokenMetaResult.usedFallback;
      }
    } else {
      const [resolvedAssetConfig, tokenMetaResult] = await Promise.all([
        getAssetConfigReadOnly(
          publicClient,
          chainConfig.entrypoint,
          assetAddress,
          rpcSession.runRead,
        ),
        resolveTokenMetadataResult(
          publicClient,
          assetAddress,
          rpcSession.runRead,
          {
            allowFallback: allowTokenMetadataFallback,
            rpcCacheKey: rpcSession.rpcUrl,
          },
        ),
      ]);
      assetConfig = resolvedAssetConfig;
      tokenMeta = tokenMetaResult.tokenMeta;
      tokenMetadataUsedFallback = tokenMetaResult.usedFallback;
    }
    const [scope, deploymentBlock] = await Promise.all([
      getScopeReadOnly(
        publicClient,
        assetConfig.pool,
        rpcSession.runRead,
      ),
      resolveRuntimeDeploymentBlock(
        chainConfig,
        rpcOverride,
        assetAddress,
        assetConfig.pool,
      ),
    ]);

    persistResolvedDescriptor = !tokenMetadataUsedFallback;
    return {
      asset: assetAddress,
      pool: assetConfig.pool,
      deploymentBlock,
      scope,
      symbol: tokenMeta.symbol,
      decimals: tokenMeta.decimals,
      minimumDepositAmount: assetConfig.minimumDepositAmount,
      vettingFeeBPS: assetConfig.vettingFeeBPS,
      maxRelayFeeBPS: assetConfig.maxRelayFeeBPS,
    } satisfies PoolStats;
  })();

  resolvedPoolCache.set(cacheKey, poolPromise);
  try {
    const resolvedPool = await poolPromise;
    if (!persistResolvedDescriptor) {
      resolvedPoolCache.delete(cacheKey);
    }
    return resolvedPool;
  } catch (error) {
    resolvedPoolCache.delete(cacheKey);
    throw error;
  }
}

export async function listPools(
  chainConfig: ChainConfig,
  rpcOverride?: string
): Promise<PoolStats[]> {
  const startedAt = runtimeStopwatch();
  const rpcSession = await getReadOnlyRpcSession(chainConfig, rpcOverride);

  let statsData: unknown;
  let aspUnreachable = false;
  try {
    statsData = await fetchPoolsStats(chainConfig);
  } catch {
    statsData = [];
    aspUnreachable = true;
  }

  const statsEntries = normalizeStatsEntries(statsData);

  const pools: PoolStats[] = [];

  if (aspUnreachable && statsEntries.length === 0) {
    emitRuntimeDiagnostic("pool-resolution", {
      chain: chainConfig.name,
      operation: "list",
      aspEntries: 0,
      resolvedPools: 0,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "asp-unreachable",
    });
    throw new CLIError(
      `Cannot reach ASP (${sanitizeEndpointForDisplay(chainConfig.aspHost)}) to discover pools.`,
      "ASP",
      "Check your network connection, or try again later."
    );
  }

  if (statsEntries.length > 0) {
    let rpcReadFailures = 0;

    const resolveEntry = async (entry: unknown) => {
      try {
        const assetAddress = resolvePoolAssetAddress(
          entry as Record<string, unknown>
        );
        if (!assetAddress) return null;
        const pool = await resolveReadOnlyPoolDescriptor(
          chainConfig,
          rpcSession,
          assetAddress,
          rpcOverride,
        );
        const metrics = parsePoolStatsEntry(entry as Record<string, unknown>);

        return {
          ...pool,
          ...metrics,
        } satisfies PoolStats;
      } catch (error) {
        if (isRpcLikeError(error)) {
          rpcReadFailures++;
        }
        return null;
      }
    };

    // Resolve first pool sequentially to settle multicall viability
    // before launching the rest in parallel.  This prevents redundant
    // multicall attempts when the RPC does not support it.
    const firstResult = await resolveEntry(statsEntries[0]);
    const restResults = statsEntries.length > 1
      ? await Promise.all(statsEntries.slice(1).map(resolveEntry))
      : [];
    const results = [firstResult, ...restResults];

    const seenPools = new Set<string>();
    for (const result of results) {
      if (result !== null) {
        const key = result.pool.toLowerCase();
        if (!seenPools.has(key)) {
          seenPools.add(key);
          pools.push(result);
        }
      }
    }

    if (pools.length === 0 && rpcReadFailures > 0) {
      emitRuntimeDiagnostic("pool-resolution", {
        chain: chainConfig.name,
        operation: "list",
        aspEntries: statsEntries.length,
        resolvedPools: 0,
        rpcReadFailures,
        elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
        outcome: "rpc-error",
      });
      throw new CLIError(
        `Failed to resolve pools on ${chainConfig.name} due to RPC errors.`,
        "RPC",
        "Check your RPC URL and network connectivity, then retry.",
        "RPC_POOL_RESOLUTION_FAILED",
        true
      );
    }
  }

  emitRuntimeDiagnostic("pool-resolution", {
    chain: chainConfig.name,
    operation: "list",
    aspEntries: statsEntries.length,
    resolvedPools: pools.length,
    elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
    outcome: aspUnreachable ? "fallback" : "ok",
  });

  return pools;
}

async function resolveKnownPoolAddress(
  rpcSession: ReadOnlyRpcSession,
  chainConfig: ChainConfig,
  knownAddress: Address,
  assetInput: string,
  rpcOverride?: string,
  options: ResolveReadOnlyPoolDescriptorOptions = {},
): Promise<PoolStats> {
  try {
    return await resolveReadOnlyPoolDescriptor(
      chainConfig,
      rpcSession,
      knownAddress,
      rpcOverride,
      options,
    );
  } catch {
    throw new CLIError(
      `Built-in pool fallback also failed for "${assetInput}" on ${chainConfig.name}.`,
      "RPC",
      "Check your RPC URL and network connectivity, then retry.",
      "RPC_POOL_RESOLUTION_FAILED",
      true
    );
  }
}

async function resolveKnownPool(
  rpcSession: ReadOnlyRpcSession,
  chainConfig: ChainConfig,
  normalizedSymbol: string,
  assetInput: string,
  rpcOverride?: string,
): Promise<PoolStats | null> {
  const knownAddress = KNOWN_POOLS[chainConfig.id]?.[normalizedSymbol];
  if (!knownAddress) return null;

  return resolveKnownPoolAddress(
    rpcSession,
    chainConfig,
    knownAddress,
    assetInput,
    rpcOverride,
  );
}

export async function listKnownPoolsFromRegistry(
  chainConfig: ChainConfig,
  rpcOverride?: string
): Promise<PoolStats[]> {
  const knownEntries = Object.entries(KNOWN_POOLS[chainConfig.id] ?? {}).filter(
    ([, address], index, entries) =>
      entries.findIndex(([, candidate]) =>
        candidate.toLowerCase() === address.toLowerCase(),
      ) === index,
  ) as Array<[string, Address]>;
  if (knownEntries.length === 0) return [];

  const rpcSession = await getReadOnlyRpcSession(chainConfig, rpcOverride);
  const pools = await Promise.all(
    knownEntries.map(([symbol, address]) =>
      resolveKnownPoolAddress(
        rpcSession,
        chainConfig,
        address,
        symbol,
        rpcOverride,
        { allowTokenMetadataFallback: true },
      ),
    ),
  );

  const seenPools = new Set<string>();
  return pools.filter((pool) => {
    const key = pool.pool.toLowerCase();
    if (seenPools.has(key)) return false;
    seenPools.add(key);
    return true;
  });
}

export async function resolvePool(
  chainConfig: ChainConfig,
  assetInput: string,
  rpcOverride?: string
): Promise<PoolStats> {
  const startedAt = runtimeStopwatch();
  const rpcSession = await getReadOnlyRpcSession(chainConfig, rpcOverride);
  const publicClient = rpcSession.publicClient;
  const hasCustomRpc = hasCustomRpcOverride(chainConfig.id, rpcOverride);

  // If it looks like an address, validate on-chain directly
  if (/^0x[0-9a-fA-F]{40}$/.test(assetInput)) {
    const assetAddress = assetInput as Address;
    try {
      return await resolveReadOnlyPoolDescriptor(
        chainConfig,
        rpcSession,
        assetAddress,
        rpcOverride,
      );
    } catch (error) {
      emitRuntimeDiagnostic("pool-resolution", {
        chain: chainConfig.name,
        operation: "resolve",
        mode: "address",
        asset: assetInput,
        elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
        outcome: isRpcLikeError(error) ? "rpc-error" : "input-error",
      });
      if (isRpcLikeError(error)) {
        throw new CLIError(
          `Failed to resolve pool for ${assetInput} on ${chainConfig.name} due to RPC error.`,
          "RPC",
          "Check your RPC URL and network connectivity, then retry.",
          "RPC_POOL_RESOLUTION_FAILED",
          true
        );
      }
      throw new CLIError(
        `No pool found for asset ${assetInput} on ${chainConfig.name}.`,
        "INPUT",
        "Check the asset address and chain."
      );
    }
  }

  // Try to resolve by symbol name via ASP first.
  const normalized = assetInput.toUpperCase();
  try {
    const knownPool = await resolveKnownPool(
      rpcSession,
      chainConfig,
      normalized,
      assetInput,
      rpcOverride,
    );
    if (knownPool) {
      emitRuntimeDiagnostic("pool-resolution", {
        chain: chainConfig.name,
        operation: "resolve",
        mode: "known-pool",
        asset: assetInput,
        elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
        outcome: "ok",
      });
      return knownPool;
    }
  } catch (error) {
    emitRuntimeDiagnostic("pool-resolution", {
      chain: chainConfig.name,
      operation: "resolve",
      mode: "known-pool",
      asset: assetInput,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "error",
      errorCategory: error instanceof CLIError ? error.category : undefined,
    });
    if (!hasCustomRpc) {
      throw error;
    }
  }

  let availableAssetsHint: string | null = null;
  let aspLookupFailed = false;

  try {
    const pools = await listPools(chainConfig, rpcOverride);
    const match = pools.find((p) => p.symbol.toUpperCase() === normalized);

    if (match) {
      emitRuntimeDiagnostic("pool-resolution", {
        chain: chainConfig.name,
        operation: "resolve",
        mode: "asp-list",
        asset: assetInput,
        elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
        outcome: "ok",
      });
      return match;
    }
    availableAssetsHint = pools.map((p) => p.symbol).join(", ");
  } catch (error) {
    // Re-throw non-ASP errors (e.g. INPUT errors from the block above).
    if (error instanceof CLIError && error.category !== "ASP") {
      emitRuntimeDiagnostic("pool-resolution", {
        chain: chainConfig.name,
        operation: "resolve",
        mode: "asp-list",
        asset: assetInput,
        elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
        outcome: "error",
        errorCategory: error.category,
      });
      throw error;
    }
    // ASP unavailable — fall through to hardcoded fallback.
    aspLookupFailed = true;
  }

  // Fallback: resolve symbol via hardcoded known-pool registry and
  // verify on-chain. This keeps asset-specific commands working when
  // public pool discovery is incomplete or temporarily unavailable.
  if (!aspLookupFailed) {
    emitRuntimeDiagnostic("pool-resolution", {
      chain: chainConfig.name,
      operation: "resolve",
      mode: "asp-list",
      asset: assetInput,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "not-found",
    });
    throw new CLIError(
      `No pool found for asset "${assetInput}" on ${chainConfig.name}.`,
      "INPUT",
      availableAssetsHint
        ? `Available assets: ${availableAssetsHint}`
        : "No pools found. Try using --asset with a contract address."
    );
  }

  emitRuntimeDiagnostic("pool-resolution", {
    chain: chainConfig.name,
    operation: "resolve",
    mode: "asp-list",
    asset: assetInput,
    elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
    outcome: "asp-unreachable",
  });
  throw new CLIError(
    `No pool found for asset "${assetInput}" on ${chainConfig.name}.`,
    "INPUT",
    "The ASP may be offline. Try using --asset with a token contract address (0x...)."
  );
}
