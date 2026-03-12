import type { Address, PublicClient } from "viem";
import { erc20Abi, parseAbi } from "viem";
import type { ChainConfig, PoolStats } from "../types.js";
import { NATIVE_ASSET_ADDRESS, KNOWN_POOLS } from "../config/chains.js";
import { resolvePoolDeploymentBlock } from "../config/deployment-hints.js";
import { fetchPoolsStats, type PoolStatsEntry } from "./asp.js";
import { getPublicClient } from "./sdk.js";
import { CLIError } from "../utils/errors.js";

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
      ? entry.assetAddress
      : typeof entry.tokenAddress === "string"
        ? entry.tokenAddress
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
  assetAddress: Address
): Promise<{ symbol: string; decimals: number }> {
  const cacheKey = `${publicClient.chain?.id ?? 0}:${assetAddress.toLowerCase()}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;

  if (
    assetAddress.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()
  ) {
    const result = { symbol: "ETH", decimals: 18 };
    tokenCache.set(cacheKey, result);
    return result;
  }

  try {
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

    const result = { symbol: symbol as string, decimals: decimals as number };
    tokenCache.set(cacheKey, result);
    return result;
  } catch {
    // Fallback for non-standard tokens
    const result = { symbol: "???", decimals: 18 };
    tokenCache.set(cacheKey, result);
    return result;
  }
}

/**
 * Read-only on-chain asset config lookup (no private key needed)
 */
async function getAssetConfigReadOnly(
  publicClient: PublicClient,
  entrypoint: Address,
  assetAddress: Address
): Promise<{
  pool: Address;
  minimumDepositAmount: bigint;
  vettingFeeBPS: bigint;
  maxRelayFeeBPS: bigint;
}> {
  const result = await publicClient.readContract({
    address: entrypoint,
    abi: entrypointAbi,
    functionName: "assetConfig",
    args: [assetAddress],
  });

  const [pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS] = result as [Address, bigint, bigint, bigint];
  return { pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS };
}

/**
 * Read-only on-chain scope lookup - calls SCOPE() on the pool contract itself
 */
async function getScopeReadOnly(
  publicClient: PublicClient,
  poolAddress: Address
): Promise<bigint> {
  return publicClient.readContract({
    address: poolAddress,
    abi: poolAbi,
    functionName: "SCOPE",
  }) as Promise<bigint>;
}

export async function listPools(
  chainConfig: ChainConfig,
  rpcOverride?: string
): Promise<PoolStats[]> {
  const publicClient = getPublicClient(chainConfig, rpcOverride);

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
    throw new CLIError(
      `Cannot reach ASP (${chainConfig.aspHost}) to discover pools.`,
      "ASP",
      "Check your network connection, or try again later."
    );
  }

  if (statsEntries.length > 0) {
    let rpcReadFailures = 0;

    const results = await Promise.all(
      statsEntries.map(async (entry) => {
        try {
          const assetAddress = resolvePoolAssetAddress(
            entry as Record<string, unknown>
          );
          if (!assetAddress) return null;

          // Fetch asset config and token metadata in parallel
          const [assetConfig, tokenMeta] = await Promise.all([
            getAssetConfigReadOnly(
              publicClient,
              chainConfig.entrypoint,
              assetAddress
            ),
            resolveTokenMetadata(publicClient, assetAddress),
          ]);

          // Scope requires the pool address from assetConfig
          const scope = await getScopeReadOnly(
            publicClient,
            assetConfig.pool
          );
          const deploymentBlock = resolvePoolDeploymentBlock(
            chainConfig.id,
            chainConfig.startBlock,
            assetAddress,
            assetConfig.pool
          );
          const metrics = parsePoolStatsEntry(entry as Record<string, unknown>);

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
            ...metrics,
          } satisfies PoolStats;
        } catch (error) {
          if (isRpcLikeError(error)) {
            rpcReadFailures++;
          }
          return null;
        }
      })
    );

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
      throw new CLIError(
        `Failed to resolve pools on ${chainConfig.name} due to RPC errors.`,
        "RPC",
        "Check your RPC URL and network connectivity, then retry.",
        "RPC_POOL_RESOLUTION_FAILED",
        true
      );
    }
  }

  return pools;
}

async function resolveKnownPool(
  publicClient: PublicClient,
  chainConfig: ChainConfig,
  normalizedSymbol: string,
  assetInput: string
): Promise<PoolStats | null> {
  const knownAddress = KNOWN_POOLS[chainConfig.id]?.[normalizedSymbol];
  if (!knownAddress) return null;

  try {
    const assetConfig = await getAssetConfigReadOnly(
      publicClient,
      chainConfig.entrypoint,
      knownAddress
    );
    const scope = await getScopeReadOnly(publicClient, assetConfig.pool);
    const { symbol, decimals } = await resolveTokenMetadata(
      publicClient,
      knownAddress
    );

    return {
      asset: knownAddress,
      pool: assetConfig.pool,
      deploymentBlock: resolvePoolDeploymentBlock(
        chainConfig.id,
        chainConfig.startBlock,
        knownAddress,
        assetConfig.pool
      ),
      scope,
      symbol,
      decimals,
      minimumDepositAmount: assetConfig.minimumDepositAmount,
      vettingFeeBPS: assetConfig.vettingFeeBPS,
      maxRelayFeeBPS: assetConfig.maxRelayFeeBPS,
    };
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

export async function resolvePool(
  chainConfig: ChainConfig,
  assetInput: string,
  rpcOverride?: string
): Promise<PoolStats> {
  const publicClient = getPublicClient(chainConfig, rpcOverride);

  // If it looks like an address, validate on-chain directly
  if (/^0x[0-9a-fA-F]{40}$/.test(assetInput)) {
    const assetAddress = assetInput as Address;
    try {
      const assetConfig = await getAssetConfigReadOnly(
        publicClient,
        chainConfig.entrypoint,
        assetAddress
      );
      const scope = await getScopeReadOnly(
        publicClient,
        assetConfig.pool
      );
      const { symbol, decimals } = await resolveTokenMetadata(
        publicClient,
        assetAddress
      );

      return {
        asset: assetAddress,
        pool: assetConfig.pool,
        deploymentBlock: resolvePoolDeploymentBlock(
          chainConfig.id,
          chainConfig.startBlock,
          assetAddress,
          assetConfig.pool
        ),
        scope,
        symbol,
        decimals,
        minimumDepositAmount: assetConfig.minimumDepositAmount,
        vettingFeeBPS: assetConfig.vettingFeeBPS,
        maxRelayFeeBPS: assetConfig.maxRelayFeeBPS,
      };
    } catch (error) {
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
  let availableAssetsHint: string | null = null;
  let aspLookupFailed = false;

  try {
    const pools = await listPools(chainConfig, rpcOverride);
    const match = pools.find((p) => p.symbol.toUpperCase() === normalized);

    if (match) return match;
    availableAssetsHint = pools.map((p) => p.symbol).join(", ");
  } catch (error) {
    // Re-throw non-ASP errors (e.g. INPUT errors from the block above).
    if (error instanceof CLIError && error.category !== "ASP") {
      throw error;
    }
    // ASP unavailable — fall through to hardcoded fallback.
    aspLookupFailed = true;
  }

  // Fallback: resolve symbol via hardcoded known-pool registry and
  // verify on-chain. This keeps asset-specific commands working when
  // public pool discovery is incomplete or temporarily unavailable.
  const knownPool = await resolveKnownPool(
    publicClient,
    chainConfig,
    normalized,
    assetInput
  );
  if (knownPool) {
    return knownPool;
  }

  if (!aspLookupFailed) {
    throw new CLIError(
      `No pool found for asset "${assetInput}" on ${chainConfig.name}.`,
      "INPUT",
      availableAssetsHint
        ? `Available assets: ${availableAssetsHint}`
        : "No pools found. Try using --asset with a contract address."
    );
  }

  throw new CLIError(
    `No pool found for asset "${assetInput}" on ${chainConfig.name}.`,
    "INPUT",
    "The ASP may be offline. Try using --asset with a token contract address (0x...)."
  );
}
