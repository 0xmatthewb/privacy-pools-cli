import {
  DataService,
  type ChainLogFetchConfig,
  type PoolInfo,
} from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, fallback, http, parseAbiItem } from "viem";
import type { PublicClient, Address, Hex } from "viem";
import type { ChainConfig } from "../types.js";
import { getRpcUrls } from "./config.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";

const LOCAL_DEPOSIT_EVENT = parseAbiItem(
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _merkleRoot)"
);
const LOCAL_WITHDRAWAL_EVENT = parseAbiItem(
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)"
);
const LOCAL_RAGEQUIT_EVENT = parseAbiItem(
  "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)"
);

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

function isLocalRpcUrl(url: string): boolean {
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

  async getDeposits(pool: PoolInfo) {
    const logs = await this.client.getLogs({
      address: pool.address,
      event: LOCAL_DEPOSIT_EVENT,
      fromBlock: pool.deploymentBlock ?? this.chainConfig.startBlock,
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
        depositor: args._depositor,
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
    const logs = await this.client.getLogs({
      address: pool.address,
      event: LOCAL_WITHDRAWAL_EVENT,
      fromBlock: fromBlock ?? pool.deploymentBlock ?? this.chainConfig.startBlock,
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
    const logs = await this.client.getLogs({
      address: pool.address,
      event: LOCAL_RAGEQUIT_EVENT,
      fromBlock: fromBlock ?? pool.deploymentBlock ?? this.chainConfig.startBlock,
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
        ragequitter: args._ragequitter,
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
  if (isLocalRpcUrl(rpcUrl)) {
    return new LocalCompatDataService(
      getPublicClient(chainConfig, rpcUrl),
      chainConfig
    ) as unknown as DataService;
  }

  const logFetchConfig: ChainLogFetchConfig = new Map();

  return new DataService(
    [
      {
        chainId: chainConfig.id,
        rpcUrl,
        privacyPoolAddress: poolAddress,
        startBlock: chainConfig.startBlock,
      },
    ],
    logFetchConfig
  );
}
