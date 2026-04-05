import {
  mainnet,
  arbitrum,
  optimism,
  sepolia,
  optimismSepolia,
} from "viem/chains";
import type { Address } from "viem";
import type { ChainConfig } from "../types.js";
import { resolveSharedAnvilChainOverride } from "./test-chain-overrides.js";

function normalizedChainEnvSuffix(chainName: string): string {
  return chainName.replace(/[^a-z0-9]/gi, "_").toUpperCase();
}

function resolveHostOverride(
  type: "ASP_HOST" | "RELAYER_HOST",
  chainName: string
): string | undefined {
  const chainSuffix = normalizedChainEnvSuffix(chainName);
  const chainScoped =
    process.env[`PRIVACY_POOLS_${type}_${chainSuffix}`]?.trim() ||
    process.env[`PP_${type}_${chainSuffix}`]?.trim();
  if (chainScoped) return chainScoped;

  const global =
    process.env[`PRIVACY_POOLS_${type}`]?.trim() ||
    process.env[`PP_${type}`]?.trim();
  return global || undefined;
}

/** Apply env-var host overrides to a chain config. */
export function resolveChainOverrides(config: ChainConfig): ChainConfig {
  const aspHostOverride = resolveHostOverride("ASP_HOST", config.name);
  const relayerHostOverride = resolveHostOverride("RELAYER_HOST", config.name);
  const sharedAnvilOverride = resolveSharedAnvilChainOverride(config);
  if (
    !aspHostOverride
    && !relayerHostOverride
    && !sharedAnvilOverride
  ) {
    return config;
  }

  return {
    ...config,
    entrypoint: (sharedAnvilOverride?.entrypoint ?? config.entrypoint) as Address,
    startBlock: sharedAnvilOverride?.startBlock ?? config.startBlock,
    aspHost: aspHostOverride ?? config.aspHost,
    relayerHost: relayerHostOverride ?? config.relayerHost,
    relayerHosts: relayerHostOverride
      ? [relayerHostOverride]
      : config.relayerHosts,
  };
}

export const CHAINS: Record<string, ChainConfig> = {
  mainnet: {
    id: 1,
    name: "mainnet",
    chain: mainnet,
    entrypoint: "0x6818809eefce719e480a7526d76bd3e561526b46",
    multicall3Address: mainnet.contracts?.multicall3?.address as Address | undefined,
    // The website uses a secure relative hypersync proxy for event scans.
    // The CLI only fills eventScanRpcUrl when it has a trustworthy absolute
    // endpoint to ship, so this remains unset for now.
    startBlock: 22153707n,
    aspHost: "https://api.0xbow.io",
    relayerHost: "https://fastrelay.xyz",
    isTestnet: false,
    avgBlockTimeSec: 12,
  },
  arbitrum: {
    id: 42161,
    name: "arbitrum",
    chain: arbitrum,
    entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
    multicall3Address: arbitrum.contracts?.multicall3?.address as Address | undefined,
    startBlock: 404391809n,
    aspHost: "https://api.0xbow.io",
    relayerHost: "https://fastrelay.xyz",
    isTestnet: false,
    avgBlockTimeSec: 0.25,
  },
  optimism: {
    id: 10,
    name: "optimism",
    chain: optimism,
    entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
    multicall3Address: optimism.contracts?.multicall3?.address as Address | undefined,
    startBlock: 144288142n,
    aspHost: "https://api.0xbow.io",
    relayerHost: "https://fastrelay.xyz",
    isTestnet: false,
    avgBlockTimeSec: 2,
  },
  sepolia: {
    id: 11155111,
    name: "sepolia",
    chain: sepolia,
    entrypoint: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
    multicall3Address: sepolia.contracts?.multicall3?.address as Address | undefined,
    startBlock: 8587019n,
    aspHost: "https://dw.0xbow.io",
    relayerHost: "https://testnet-relayer.privacypools.com",
    relayerHosts: [
      "https://testnet-relayer.privacypools.com",
      "https://fastrelay.xyz",
    ],
    isTestnet: true,
    avgBlockTimeSec: 12,
  },
  "op-sepolia": {
    id: 11155420,
    name: "op-sepolia",
    chain: optimismSepolia,
    entrypoint: "0x54aca0d27500669fa37867233e05423701f11ba1",
    multicall3Address: optimismSepolia.contracts?.multicall3?.address as Address | undefined,
    startBlock: 32900681n,
    aspHost: "https://dw.0xbow.io",
    relayerHost: "https://testnet-relayer.privacypools.com",
    isTestnet: true,
    avgBlockTimeSec: 2,
  },
};

export const CHAIN_NAMES = Object.keys(CHAINS);

/** Mainnet chain names only (excludes testnets). */
export const MAINNET_CHAIN_NAMES = CHAIN_NAMES.filter(
  (name) => !CHAINS[name].isTestnet,
);

/** Testnet chain names only. */
export const TESTNET_CHAIN_NAMES = CHAIN_NAMES.filter(
  (name) => CHAINS[name].isTestnet,
);

// ── Multi-chain scope sentinels ─────────────────────────────────────────────
// Used as the JSON `chain` value when querying multiple chains.

/** JSON `chain` value when querying all mainnets (default, no --chain). */
export const MULTI_CHAIN_SCOPE_ALL_MAINNETS = "all-mainnets";
/** JSON `chain` value when --all-chains includes testnets. */
export const MULTI_CHAIN_SCOPE_ALL_CHAINS = "all-chains";

/** Whether a chain string represents a multi-chain scope rather than a specific chain. */
export function isMultiChainScope(chain: string): boolean {
  return chain === MULTI_CHAIN_SCOPE_ALL_MAINNETS || chain === MULTI_CHAIN_SCOPE_ALL_CHAINS;
}

/** Whether a chain name refers to a testnet.  Returns `false` for unknown/null names. */
export function isTestnetChain(chainName: string | null | undefined): boolean {
  return chainName ? (CHAINS[chainName]?.isTestnet ?? false) : false;
}

/** All chain configs with host overrides applied (includes testnets). */
export function getAllChainsWithOverrides(): ChainConfig[] {
  return CHAIN_NAMES.map((name) => resolveChainOverrides(CHAINS[name]));
}

/** Default chains for read-only commands (all mainnets, with host overrides applied). */
export function getDefaultReadOnlyChains(): ChainConfig[] {
  return MAINNET_CHAIN_NAMES.map((name) => resolveChainOverrides(CHAINS[name]));
}

/** Proof of Association portal host (referenced in user-facing messages). */
export const POA_PORTAL_URL = "tornado.0xbow.io";

export const NATIVE_ASSET_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

/**
 * Native-asset aliases from the website source of truth.
 *
 * Some pools use a wrapped-native address onchain while the product treats the
 * asset as the chain's native token for balance lookup, funding, and payable
 * deposit UX. Keep this map aligned with website `chainData.ts`.
 */
const NATIVE_ASSET_ALIASES: Record<number, Address[]> = {
  11155420: ["0x4200000000000000000000000000000000000006"],
};

export function isNativePoolAsset(
  chainId: number,
  assetAddress: string | Address,
): boolean {
  const normalized = assetAddress.toLowerCase();
  if (normalized === NATIVE_ASSET_ADDRESS.toLowerCase()) {
    return true;
  }

  return (NATIVE_ASSET_ALIASES[chainId] ?? []).some(
    (alias) => alias.toLowerCase() === normalized,
  );
}

/**
 * Hardcoded symbol → asset-address map for on-chain-verified fallback.
 * Sourced from the Privacy Pools website `chainData.ts`.
 * When public pool discovery is unavailable or incomplete, `resolvePool()`
 * uses this to convert a symbol into an asset address, then verifies the
 * pool on-chain via the entrypoint contract.
 *
 * Update this map when new pools are added to the protocol.
 */
export const KNOWN_POOLS: Record<number, Record<string, Address>> = {
  // Ethereum mainnet
  1: {
    ETH: NATIVE_ASSET_ADDRESS,
    USDS: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
    SUSDS: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WSTETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    USDE: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    USD1: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
    FRXUSD: "0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29",
    WOETH: "0xDcEe70654261AF21C44c093C300eD3Bb97b78192",
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    BOLD: "0x6440f144b7e50D6a8439336510312d2F54beB01D",
  },
  // Optimism
  10: {
    ETH: NATIVE_ASSET_ADDRESS,
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
  // Arbitrum
  42161: {
    ETH: NATIVE_ASSET_ADDRESS,
    YUSND: "0x252b965400862d94bda35fecf7ee0f204a53cc36",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  // Sepolia testnet
  11155111: {
    ETH: NATIVE_ASSET_ADDRESS,
    USDT: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
    USDC: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  },
  // OP-Sepolia testnet
  11155420: {
    WETH: "0x4200000000000000000000000000000000000006",
  },
};

export const EXPLORER_URLS: Record<number, string> = {
  1: "https://etherscan.io",
  42161: "https://arbiscan.io",
  10: "https://optimistic.etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  11155420: "https://sepolia-optimism.etherscan.io",
};

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = EXPLORER_URLS[chainId];
  if (!base) return null;
  return `${base}/tx/${txHash}`;
}
