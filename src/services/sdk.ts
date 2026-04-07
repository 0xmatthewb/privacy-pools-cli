import {
  DataService,
  type PoolInfo,
} from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, fallback, http, parseAbiItem } from "viem";
import type { PublicClient, Address, Hex } from "viem";
import type { ChainConfig } from "../types.js";
import { getRpcUrl, getRpcUrls, hasCustomRpcOverride } from "./config.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";
import { withSuppressedSdkStdout } from "./account.js";

const LOG_PROBE_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOG_PROBE_RANGE = 1_024n;
const READ_ONLY_LATEST_BLOCK_TTL_MS = 1_000;

const LOCAL_DEPOSIT_EVENT = parseAbiItem(
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)"
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
const readOnlyRpcSessionCache = new Map<string, Promise<ReadOnlyRpcSession>>();

function normalizeRpcOverride(rpcOverride?: string): string {
  return rpcOverride?.trim() ?? "";
}

function healthyRpcCacheKey(chainId: number, rpcOverride?: string): string {
  return `${chainId}:${normalizeRpcOverride(rpcOverride)}`;
}

function dataServiceCacheKey(
  chainId: number,
  rpcUrl: string,
  isLocalCompat: boolean
): string {
  return `${chainId}:${rpcUrl}:${isLocalCompat ? "local" : "remote"}`;
}

function readOnlyRpcSessionCacheKey(chainId: number, rpcUrl: string): string {
  return `${chainId}:${rpcUrl}`;
}

function resolveConfiguredEventScanRpcUrl(
  chainConfig: ChainConfig,
): string | undefined {
  const candidate = chainConfig.eventScanRpcUrl?.trim();
  return candidate ? candidate : undefined;
}

async function resolveDataServiceRpcUrl(
  chainConfig: ChainConfig,
  rpcOverride?: string,
): Promise<string> {
  if (hasCustomRpcOverride(chainConfig.id, rpcOverride)) {
    return getRpcUrl(chainConfig.id, rpcOverride);
  }

  return (
    resolveConfiguredEventScanRpcUrl(chainConfig)
    ?? await getHealthyRpcUrl(chainConfig.id, rpcOverride)
  );
}

function createRpcClient(
  chainConfig: ChainConfig,
  rpcUrls: readonly string[],
): PublicClient {
  const timeoutMs = getNetworkTimeoutMs();
  const transport =
    rpcUrls.length === 1
      ? http(rpcUrls[0], { timeout: timeoutMs })
      : fallback(rpcUrls.map((url) => http(url, { timeout: timeoutMs })));
  return createPublicClient({
    chain: chainConfig.chain,
    transport,
  });
}

export interface ReadOnlyRpcSession {
  rpcUrl: string;
  publicClient: PublicClient;
  runRead<T>(cacheKey: string, loader: () => Promise<T>): Promise<T>;
  getLatestBlockNumber(): Promise<bigint>;
}

export function resetSdkServiceCachesForTests(): void {
  healthyRpcUrlCache.clear();
  dataServiceCache.clear();
  readOnlyRpcSessionCache.clear();
}

export function getPublicClient(
  chainConfig: ChainConfig,
  rpcOverride?: string
): PublicClient {
  const urls = getRpcUrls(chainConfig.id, rpcOverride);
  return createRpcClient(chainConfig, urls);
}

export async function getReadOnlyRpcSession(
  chainConfig: ChainConfig,
  rpcOverride?: string,
): Promise<ReadOnlyRpcSession> {
  const rpcUrl = await getHealthyRpcUrl(chainConfig.id, rpcOverride);
  const cacheKey = readOnlyRpcSessionCacheKey(chainConfig.id, rpcUrl);
  const cached = readOnlyRpcSessionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sessionPromise = Promise.resolve().then(() => {
    const publicClient = createRpcClient(chainConfig, [rpcUrl]);
    const inflightReads = new Map<string, Promise<unknown>>();
    let latestBlockCache:
      | { promise: Promise<bigint>; expiresAt: number }
      | null = null;

    const runRead = <T>(cacheKey: string, loader: () => Promise<T>): Promise<T> => {
      const cachedRead = inflightReads.get(cacheKey);
      if (cachedRead) {
        return cachedRead as Promise<T>;
      }

      const readPromise = loader().finally(() => {
        inflightReads.delete(cacheKey);
      });
      inflightReads.set(cacheKey, readPromise as Promise<unknown>);
      return readPromise;
    };

    const getLatestBlockNumber = (): Promise<bigint> => {
      const now = Date.now();
      if (latestBlockCache && latestBlockCache.expiresAt > now) {
        return latestBlockCache.promise;
      }

      const promise = runRead("latest-block", () => publicClient.getBlockNumber());
      latestBlockCache = {
        promise,
        expiresAt: now + READ_ONLY_LATEST_BLOCK_TTL_MS,
      };
      promise.catch(() => {
        if (latestBlockCache?.promise === promise) {
          latestBlockCache = null;
        }
      });
      return promise;
    };

    return {
      rpcUrl,
      publicClient,
      runRead,
      getLatestBlockNumber,
    } satisfies ReadOnlyRpcSession;
  });

  readOnlyRpcSessionCache.set(cacheKey, sessionPromise);
  try {
    return await sessionPromise;
  } catch (error) {
    readOnlyRpcSessionCache.delete(cacheKey);
    throw error;
  }
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

    // Race all URLs concurrently — return the first one that passes
    // both eth_blockNumber and eth_getLogs probes.
    const winner = await new Promise<string | null>((resolve) => {
      let settled = false;
      let pending = urls.length;

      for (const url of urls) {
        (async () => {
          try {
            const latestBlock = await rpcProbe<string>(
              url,
              "eth_blockNumber",
              [],
              probeTimeoutMs,
            );
            if (!latestBlock || settled) return;

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
              probeTimeoutMs,
            );
            if (Array.isArray(logProbe) && !settled) {
              settled = true;
              resolve(url);
            }
          } catch {
            // URL unhealthy
          } finally {
            pending--;
            if (pending === 0 && !settled) {
              resolve(null);
            }
          }
        })();
      }
    });

    // All probes failed; return first URL so downstream gets the natural error.
    return winner ?? urls[0];
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
  private latestBlockCache:
    | { promise: Promise<bigint>; expiresAt: number }
    | null = null;

  constructor(
    private readonly client: PublicClient,
    private readonly chainConfig: ChainConfig,
  ) {}

  private getLatestBlockNumber(): Promise<bigint> {
    const now = Date.now();
    if (this.latestBlockCache && this.latestBlockCache.expiresAt > now) {
      return this.latestBlockCache.promise;
    }

    const promise = this.client.getBlockNumber();
    this.latestBlockCache = {
      promise,
      expiresAt: now + READ_ONLY_LATEST_BLOCK_TTL_MS,
    };
    promise.catch(() => {
      if (this.latestBlockCache?.promise === promise) {
        this.latestBlockCache = null;
      }
    });
    return promise;
  }

  private async resolveFromBlock(candidate?: bigint): Promise<bigint | null> {
    const requested = candidate ?? this.chainConfig.startBlock;
    const latest = await this.getLatestBlockNumber();
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
        _precommitmentHash?: bigint;
      };

      if (
        !args?._depositor ||
        args._commitment === undefined ||
        args._commitment === null ||
        args._label === undefined ||
        args._label === null ||
        !log.blockNumber ||
        !log.transactionHash ||
        args._precommitmentHash === undefined ||
        args._precommitmentHash === null
      ) {
        throw new Error("Malformed deposit log");
      }

      return {
        depositor: args._depositor.toLowerCase(),
        commitment: args._commitment,
        label: args._label,
        value: args._value ?? 0n,
        precommitment: args._precommitmentHash,
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
        args._spentNullifier === undefined ||
        args._spentNullifier === null ||
        args._newCommitment === undefined ||
        args._newCommitment === null ||
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
        args._commitment === undefined ||
        args._commitment === null ||
        args._label === undefined ||
        args._label === null ||
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
  const rpcUrl = await resolveDataServiceRpcUrl(chainConfig, rpcOverride);
  const useLocalCompat = isLocalRpcUrl(rpcUrl);
  const cacheKey = dataServiceCacheKey(
    chainConfig.id,
    rpcUrl,
    useLocalCompat,
  );
  const cached = dataServiceCache.get(cacheKey);
  if (cached) return cached;

  const dataServicePromise = useLocalCompat
    ? (async () => {
        const rpcSession = await getReadOnlyRpcSession(chainConfig, rpcUrl);
        return new LocalCompatDataService(
          rpcSession.publicClient,
          chainConfig,
        ) as unknown as DataService;
      })()
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
