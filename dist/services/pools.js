import { erc20Abi, parseAbi } from "viem";
import { NATIVE_ASSET_ADDRESS } from "../config/chains.js";
import { fetchPoolsStats } from "./asp.js";
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
const tokenCache = new Map();
function isRpcLikeError(error) {
    if (error instanceof CLIError) {
        return error.category === "RPC";
    }
    const message = error instanceof Error ? error.message : String(error);
    return (message.includes("fetch") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ETIMEDOUT") ||
        message.includes("timeout") ||
        message.includes("network"));
}
export async function resolveTokenMetadata(publicClient, assetAddress) {
    const cacheKey = `${publicClient.chain?.id ?? 0}:${assetAddress.toLowerCase()}`;
    const cached = tokenCache.get(cacheKey);
    if (cached)
        return cached;
    if (assetAddress.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()) {
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
        const result = { symbol: symbol, decimals: decimals };
        tokenCache.set(cacheKey, result);
        return result;
    }
    catch {
        // Fallback for non-standard tokens
        const result = { symbol: "???", decimals: 18 };
        tokenCache.set(cacheKey, result);
        return result;
    }
}
/**
 * Read-only on-chain asset config lookup (no private key needed)
 */
async function getAssetConfigReadOnly(publicClient, entrypoint, assetAddress) {
    const result = await publicClient.readContract({
        address: entrypoint,
        abi: entrypointAbi,
        functionName: "assetConfig",
        args: [assetAddress],
    });
    const [pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS] = result;
    return { pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS };
}
/**
 * Read-only on-chain scope lookup - calls SCOPE() on the pool contract itself
 */
async function getScopeReadOnly(publicClient, poolAddress) {
    return publicClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "SCOPE",
    });
}
export async function listPools(chainConfig, rpcOverride) {
    const publicClient = getPublicClient(chainConfig, rpcOverride);
    let statsData;
    let aspUnreachable = false;
    try {
        statsData = await fetchPoolsStats(chainConfig);
    }
    catch {
        statsData = [];
        aspUnreachable = true;
    }
    const statsEntries = Array.isArray(statsData)
        ? statsData
        : Array.isArray(statsData?.pools)
            ? (statsData.pools ?? [])
            : [];
    const pools = [];
    if (aspUnreachable && statsEntries.length === 0) {
        throw new CLIError(`Cannot reach ASP (${chainConfig.aspHost}) to discover pools.`, "ASP", "Check your network connection, or try again later.");
    }
    if (statsEntries.length > 0) {
        let rpcReadFailures = 0;
        for (const entry of statsEntries) {
            try {
                const assetAddress = entry.assetAddress;
                const assetConfig = await getAssetConfigReadOnly(publicClient, chainConfig.entrypoint, assetAddress);
                const scope = await getScopeReadOnly(publicClient, assetConfig.pool);
                const { symbol, decimals } = await resolveTokenMetadata(publicClient, assetAddress);
                pools.push({
                    asset: assetAddress,
                    pool: assetConfig.pool,
                    scope,
                    symbol,
                    decimals,
                    minimumDepositAmount: assetConfig.minimumDepositAmount,
                    vettingFeeBPS: assetConfig.vettingFeeBPS,
                    maxRelayFeeBPS: assetConfig.maxRelayFeeBPS,
                });
            }
            catch (error) {
                if (isRpcLikeError(error)) {
                    rpcReadFailures++;
                }
                // Skip pools that fail on-chain validation/metadata fetch
                continue;
            }
        }
        if (pools.length === 0 && rpcReadFailures > 0) {
            throw new CLIError(`Failed to resolve pools on ${chainConfig.name} due to RPC errors.`, "RPC", "Check your RPC URL and network connectivity, then retry.", "RPC_POOL_RESOLUTION_FAILED", true);
        }
    }
    return pools;
}
export async function resolvePool(chainConfig, assetInput, rpcOverride) {
    const publicClient = getPublicClient(chainConfig, rpcOverride);
    // If it looks like an address, validate on-chain directly
    if (assetInput.startsWith("0x") && assetInput.length === 42) {
        const assetAddress = assetInput;
        try {
            const assetConfig = await getAssetConfigReadOnly(publicClient, chainConfig.entrypoint, assetAddress);
            const scope = await getScopeReadOnly(publicClient, assetConfig.pool);
            const { symbol, decimals } = await resolveTokenMetadata(publicClient, assetAddress);
            return {
                asset: assetAddress,
                pool: assetConfig.pool,
                scope,
                symbol,
                decimals,
                minimumDepositAmount: assetConfig.minimumDepositAmount,
                vettingFeeBPS: assetConfig.vettingFeeBPS,
                maxRelayFeeBPS: assetConfig.maxRelayFeeBPS,
            };
        }
        catch (error) {
            if (isRpcLikeError(error)) {
                throw new CLIError(`Failed to resolve pool for ${assetInput} on ${chainConfig.name} due to RPC error.`, "RPC", "Check your RPC URL and network connectivity, then retry.", "RPC_POOL_RESOLUTION_FAILED", true);
            }
            throw new CLIError(`No pool found for asset ${assetInput} on ${chainConfig.name}.`, "INPUT", "Check the asset address and chain.");
        }
    }
    // Try to resolve by symbol name
    const pools = await listPools(chainConfig, rpcOverride);
    const normalized = assetInput.toUpperCase();
    const match = pools.find((p) => p.symbol.toUpperCase() === normalized);
    if (!match) {
        const available = pools.map((p) => p.symbol).join(", ");
        throw new CLIError(`No pool found for asset "${assetInput}" on ${chainConfig.name}.`, "INPUT", available
            ? `Available assets: ${available}`
            : "No pools found. Try using --asset with a contract address.");
    }
    return match;
}
