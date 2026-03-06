import { DataService } from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, fallback, http } from "viem";
import type { PublicClient, Address } from "viem";
import type { ChainConfig } from "../types.js";
import { getRpcUrls } from "./config.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";

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
