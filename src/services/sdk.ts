import {
  DataService,
  type PoolInfo,
} from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, fallback, http, parseAbiItem } from "viem";
import type { PublicClient, Address, Hex } from "viem";
import type { ChainConfig } from "../types.js";
import { getRpcUrls } from "./config.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";
import { withSuppressedSdkStdout } from "./account.js";

const LOG_PROBE_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOG_PROBE_RANGE = 1_024n;

const LOCAL_DEPOSIT_EVENT = parseAbiItem(
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _merkleRoot)"
);
const LOCAL_WITHDRAWAL_EVENT = parseAbiItem(
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)"
);
const LOCAL_RAGEQUIT_EVENT = parseAbiItem(
  "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)"
);

const DATA_SERVICE_LOG_FETCH_CONFIG = new Map<
  number,
  {
    blockChunkSize: number;
    concurrency: number;
    chunkDelayMs: number;
    retryOnFailure: boolean;
    maxRetries: number;
    retryBaseDelayMs: number;
  }
>([
  [
    1,
    {
      blockChunkSize: 1_250_000,
      concurrency: 1,
      chunkDelayMs: 0,
      retryOnFailure: true,
      maxRetries: 3,
      retryBaseDelayMs: 500,
    },
  ],
  [
    10,
    {
      blockChunkSize: 12_000_000,
      concurrency: 1,
      chunkDelayMs: 0,
      retryOnFailure: true,
      maxRetries: 3,
      retryBaseDelayMs: 500,
    },
  ],
  [
    42161,
    {
      blockChunkSize: 48_000_000,
      concurrency: 1,
      chunkDelayMs: 0,
      retryOnFailure: true,
      maxRetries: 3,
      retryBaseDelayMs: 500,
    },
  ],
]);

const healthyRpcUrlCache = new Map<string, Promise<string>>();
const dataServiceCache = new Map<string, Promise<DataService>>();

function normalizeRpcOverride(rpcOverride?: string): string {
  return rpcOverride?.trim() ?? "";
}

function healthyRpcCacheKey(chainId: number, rpcOverride?: string): string {
  return `${chainId}:${normalizeRpcOverride(rpcOverride)}`;
}

function dataServiceCacheKey(
  chainId: number,
  poolAddress: Address,
  rpcUrl: string,
  isLocalCompat: boolean
): string {
  return `${chainId}:${poolAddress.toLowerCase()}:${rpcUrl}:${isLocalCompat ? "local" : "remote"}`;
}

export function resetSdkServiceCachesForTests(): void {
  healthyRpcUrlCache.clear();
  dataServiceCache.clear();
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
 * both `eth_blockNumber` and a representative `eth_getLogs` call within
 * a short timeout. Falls back to the first URL if all probes fail so the
 * caller still gets the natural error.
 *
 * When only a single URL is available the probe is skipped entirely
 * (fast path – no network call).
 */
export async function getHealthyRpcUrl(
  chainId: number,
  rpcOverride?: string
): Promise<string> {
  const cacheKey = healthyRpcCacheKey(chainId, rpcOverride);
  const cached = healthyRpcUrlCache.get(cacheKey);
  if (cached) return cached;

  const probePromise = (async () => {
    const urls = getRpcUrls(chainId, rpcOverride);
    if (urls.length <= 1) return urls[0];

    const probeTimeoutMs = Math.min(getNetworkTimeoutMs(), 3_000);

    for (const url of urls) {
      try {
        const latestBlock = await rpcProbe<string>(
          url,
          "eth_blockNumber",
          [],
          probeTimeoutMs
        );
        if (!latestBlock) continue;

        const toBlock = BigInt(latestBlock);
        const fromBlock = toBlock > LOG_PROBE_RANGE ? toBlock - LOG_PROBE_RANGE : 0n;
        const logProbe = await rpcProbe<unknown>(
          url,
          "eth_getLogs",
          [{
            address: LOG_PROBE_ADDRESS,
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
          }],
          probeTimeoutMs
        );
        if (Array.isArray(logProbe)) return url;
      } catch {
        // URL unhealthy – try next
      }
    }

    // All probes failed; return first URL so downstream gets the natural error.
    return urls[0];
  })();

  healthyRpcUrlCache.set(cacheKey, probePromise);
  try {
    return await probePromise;
  } catch (error) {
    healthyRpcUrlCache.delete(cacheKey);
    throw error;
  }
}

async function rpcProbe<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number
): Promise<T | undefined> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) return undefined;
  const json = (await res.json()) as {
    result?: T;
    error?: unknown;
  };
  if (json.error !== undefined) return undefined;
  return json.result;
}

export function isLocalRpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "0.0.0.0" ||
      parsed.hostname === "host.docker.internal"
    );
  } catch {
    return false;
  }
}

class LocalCompatDataService {
  constructor(
    private readonly client: PublicClient,
    private readonly chainConfig: ChainConfig
  ) {}

  private async resolveFromBlock(candidate?: bigint): Promise<bigint | null> {
    const requested = candidate ?? this.chainConfig.startBlock;
    const latest = await this.client.getBlockNumber();
    return requested > latest ? null : requested;
  }

  async getDeposits(pool: PoolInfo) {
    const fromBlock = await this.resolveFromBlock(
      pool.deploymentBlock ?? this.chainConfig.startBlock,
    );
    if (fromBlock === null) return [];
    const logs = await this.client.getLogs({
      address: pool.address,
      event: LOCAL_DEPOSIT_EVENT,
      fromBlock,
    });

    return logs.map((log) => {
      const args = log.args as {
        _depositor?: string;
        _commitment?: bigint;
        _label?: bigint;
        _value?: bigint;
        _merkleRoot?: bigint;
      };

      if (
        !args?._depositor ||
        !args._commitment ||
        !args._label ||
        !log.blockNumber ||
        !log.transactionHash ||
        args._merkleRoot === undefined ||
        args._merkleRoot === null
      ) {
        throw new Error("Malformed deposit log");
      }

      return {
        depositor: args._depositor.toLowerCase(),
        commitment: args._commitment,
        label: args._label,
        value: args._value ?? 0n,
        precommitment: args._merkleRoot,
        blockNumber: BigInt(log.blockNumber),
        transactionHash: log.transactionHash as Hex,
      };
    });
  }

  async getWithdrawals(pool: PoolInfo, fromBlock?: bigint) {
    const resolvedFromBlock = await this.resolveFromBlock(
      fromBlock ?? pool.deploymentBlock ?? this.chainConfig.startBlock,
    );
    if (resolvedFromBlock === null) return [];
    const logs = await this.client.getLogs({
      address: pool.address,
      event: LOCAL_WITHDRAWAL_EVENT,
      fromBlock: resolvedFromBlock,
    });

    return logs.map((log) => {
      const args = log.args as {
        _value?: bigint;
        _spentNullifier?: bigint;
        _newCommitment?: bigint;
      };

      if (
        args?._value === undefined ||
        args?._value === null ||
        !args._spentNullifier ||
        !args._newCommitment ||
        !log.blockNumber ||
        !log.transactionHash
      ) {
        throw new Error("Malformed withdrawal log");
      }

      return {
        withdrawn: args._value,
        spentNullifier: args._spentNullifier,
        newCommitment: args._newCommitment,
        blockNumber: BigInt(log.blockNumber),
        transactionHash: log.transactionHash as Hex,
      };
    });
  }

  async getRagequits(pool: PoolInfo, fromBlock?: bigint) {
    const resolvedFromBlock = await this.resolveFromBlock(
      fromBlock ?? pool.deploymentBlock ?? this.chainConfig.startBlock,
    );
    if (resolvedFromBlock === null) return [];
    const logs = await this.client.getLogs({
      address: pool.address,
      event: LOCAL_RAGEQUIT_EVENT,
      fromBlock: resolvedFromBlock,
    });

    return logs.map((log) => {
      const args = log.args as {
        _ragequitter?: string;
        _commitment?: bigint;
        _label?: bigint;
        _value?: bigint;
      };

      if (
        !args?._ragequitter ||
        !args._commitment ||
        !args._label ||
        !log.blockNumber ||
        !log.transactionHash
      ) {
        throw new Error("Malformed ragequit log");
      }

      return {
        ragequitter: args._ragequitter.toLowerCase(),
        commitment: args._commitment,
        label: args._label,
        value: args._value ?? 0n,
        blockNumber: BigInt(log.blockNumber),
        transactionHash: log.transactionHash as Hex,
      };
    });
  }
}

export async function getDataService(
  chainConfig: ChainConfig,
  poolAddress: Address,
  rpcOverride?: string
): Promise<DataService> {
  const rpcUrl = await getHealthyRpcUrl(chainConfig.id, rpcOverride);
  const useLocalCompat = isLocalRpcUrl(rpcUrl);
  const cacheKey = dataServiceCacheKey(
    chainConfig.id,
    poolAddress,
    rpcUrl,
    useLocalCompat,
  );
  const cached = dataServiceCache.get(cacheKey);
  if (cached) return cached;

  const dataServicePromise = useLocalCompat
    ? Promise.resolve(
        new LocalCompatDataService(
          getPublicClient(chainConfig, rpcUrl),
          chainConfig
        ) as unknown as DataService
      )
    : withSuppressedSdkStdout(async () =>
        new DataService(
          [
            {
              chainId: chainConfig.id,
              rpcUrl,
              privacyPoolAddress: poolAddress,
              startBlock: chainConfig.startBlock,
            },
          ],
          DATA_SERVICE_LOG_FETCH_CONFIG
        )
      );

  dataServiceCache.set(cacheKey, dataServicePromise);
  try {
    return await dataServicePromise;
  } catch (error) {
    dataServiceCache.delete(cacheKey);
    throw error;
  }
}
