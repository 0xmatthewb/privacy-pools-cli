import {
  PrivacyPoolSDK,
  DataService,
} from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, fallback, http } from "viem";
import type { PublicClient, Address } from "viem";
import type { ChainConfig } from "../types.js";
import { getRpcUrls } from "./config.js";
import { loadPrivateKey } from "./wallet.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";

// Use dynamic import for Circuits since it may need async init
let _circuits: any = null;
let _sdk: PrivacyPoolSDK | null = null;

async function getCircuits() {
  if (_circuits) return _circuits;

  const { Circuits } = await import("@0xbow/privacy-pools-core-sdk");
  _circuits = new Circuits({ browser: false });
  return _circuits;
}

export async function getSDK(): Promise<PrivacyPoolSDK> {
  if (_sdk) return _sdk;

  const circuits = await getCircuits();
  _sdk = new PrivacyPoolSDK(circuits);
  return _sdk;
}

export async function getContracts(
  chainConfig: ChainConfig,
  rpcOverride?: string,
  privateKeyOverride?: string
) {
  const sdk = await getSDK();
  const rpcUrl = await getHealthyRpcUrl(chainConfig.id, rpcOverride);
  const privateKey = privateKeyOverride ?? loadPrivateKey();

  return sdk.createContractInstance(
    rpcUrl,
    chainConfig.chain as any,
    chainConfig.entrypoint,
    privateKey as `0x${string}`
  );
}

export function getPublicClient(
  chainConfig: ChainConfig,
  rpcOverride?: string
): PublicClient {
  const urls = getRpcUrls(chainConfig.id, rpcOverride);
  const timeoutMs = getNetworkTimeoutMs();
  const transport =
    urls.length === 1
      ? http(urls[0], { timeout: timeoutMs })
      : fallback(urls.map((url) => http(url, { timeout: timeoutMs })));
  return createPublicClient({
    chain: chainConfig.chain,
    transport,
  });
}

/**
 * Probes RPC URLs in order and returns the first that responds to
 * `eth_blockNumber` within a short timeout.  Falls back to the first
 * URL if all probes fail so the caller still gets the natural error.
 *
 * When only a single URL is available the probe is skipped entirely
 * (fast path – no network call).
 */
export async function getHealthyRpcUrl(
  chainId: number,
  rpcOverride?: string
): Promise<string> {
  const urls = getRpcUrls(chainId, rpcOverride);
  if (urls.length <= 1) return urls[0];

  const probeTimeoutMs = Math.min(getNetworkTimeoutMs(), 3_000);

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: string };
        if (json.result) return url;
      }
    } catch {
      // URL unhealthy – try next
    }
  }

  // All probes failed; return first URL so downstream gets the natural error.
  return urls[0];
}

export async function getDataService(
  chainConfig: ChainConfig,
  poolAddress: Address,
  rpcOverride?: string
): Promise<DataService> {
  const rpcUrl = await getHealthyRpcUrl(chainConfig.id, rpcOverride);
  return new DataService([
    {
      chainId: chainConfig.id,
      rpcUrl,
      privacyPoolAddress: poolAddress,
      startBlock: chainConfig.startBlock,
    },
  ]);
}

