import {
  PrivacyPoolSDK,
  DataService,
} from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, fallback, http } from "viem";
import type { PublicClient, Address } from "viem";
import type { ChainConfig } from "../types.js";
import { getRpcUrl, getRpcUrls } from "./config.js";
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
  const rpcUrl = getRpcUrl(chainConfig.id, rpcOverride);
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

export function getDataService(
  chainConfig: ChainConfig,
  poolAddress: Address,
  rpcOverride?: string
): DataService {
  const rpcUrl = getRpcUrl(chainConfig.id, rpcOverride);
  return new DataService([
    {
      chainId: chainConfig.id,
      rpcUrl,
      privacyPoolAddress: poolAddress,
      startBlock: chainConfig.startBlock,
    },
  ]);
}

export async function warmCircuits(): Promise<void> {
  const circuits = await getCircuits();
  // Init artifacts triggers download/cache
  if (typeof circuits.initArtifacts === "function") {
    await circuits.initArtifacts("latest");
  }
}
