import type { Address, Hex } from "viem";
import type { Chain } from "viem/chains";

export interface ChainConfig {
  id: number;
  name: string;
  chain: Chain;
  entrypoint: Address;
  startBlock: bigint;
  aspHost: string;
  relayerHost: string;
  isTestnet: boolean;
}

export interface CLIConfig {
  defaultChain: string;
  rpcOverrides: Record<number, string>;
}

export interface GlobalOptions {
  chain?: string;
  rpcUrl?: string;
  json?: boolean;
  agent?: boolean;
  quiet?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export interface PoolStats {
  asset: Address;
  pool: Address;
  scope: bigint;
  symbol: string;
  decimals: number;
  minimumDepositAmount: bigint;
  vettingFeeBPS: bigint;
  maxRelayFeeBPS: bigint;
  totalInPoolValue?: bigint;
  totalInPoolValueUsd?: string;
  totalDepositsValue?: bigint;
  totalDepositsValueUsd?: string;
  acceptedDepositsValue?: bigint;
  acceptedDepositsValueUsd?: string;
  pendingDepositsValue?: bigint;
  pendingDepositsValueUsd?: string;
  totalDepositsCount?: number;
  acceptedDepositsCount?: number;
  pendingDepositsCount?: number;
  growth24h?: number | null;
  pendingGrowth24h?: number | null;
}

export interface AspEventPoolRef {
  chainId?: number;
  poolAddress?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  denomination?: string;
}

export interface AspPublicEvent {
  type?: string;
  txHash?: string;
  timestamp?: number | string;
  amount?: string;
  publicAmount?: string;
  reviewStatus?: string;
  pool?: AspEventPoolRef;
  [key: string]: unknown;
}

export interface AspEventsPageResponse {
  events?: AspPublicEvent[];
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
}

export interface TimeBasedStatistics {
  tvl?: string;
  tvlUsd?: string;
  avgDepositSize?: string;
  avgDepositSizeUsd?: string;
  totalDepositsCount?: number;
  totalDepositsValue?: string;
  totalDepositsValueUsd?: string;
  totalWithdrawalsCount?: number;
  totalWithdrawalsValue?: string;
  totalWithdrawalsValueUsd?: string;
}

export interface PoolStatisticsResponse {
  pool?: {
    scope?: string;
    chainId?: string;
    tokenSymbol?: string;
    tokenAddress?: string;
    tokenDecimals?: number;
    allTime?: TimeBasedStatistics;
    last24h?: TimeBasedStatistics;
  };
  cacheTimestamp?: string;
}

export interface GlobalStatisticsResponse {
  allTime?: TimeBasedStatistics;
  last24h?: TimeBasedStatistics;
  cacheTimestamp?: string;
}

export interface MtRootsResponse {
  mtRoot: string;
  createdAt: string;
  onchainMtRoot: string;
}

export interface MtLeavesResponse {
  aspLeaves: string[];
  stateTreeLeaves: string[];
}

export interface RelayerDetailsResponse {
  chainId: number;
  feeBPS: string;
  minWithdrawAmount: string;
  feeReceiverAddress: Address;
  assetAddress: Address;
  maxGasPrice: string;
}

export interface RelayerQuoteResponse {
  baseFeeBPS: string;
  feeBPS: string;
  gasPrice: string;
  detail: {
    relayTxCost: { gas: string; eth: string };
  };
  feeCommitment?: {
    expiration: number;
    withdrawalData: Hex;
    asset: Address;
    amount: string;
    extraGas: boolean;
    signedRelayerCommitment: Hex;
  };
}

export interface RelayerRequestResponse {
  success: boolean;
  txHash: Hex;
  timestamp: number;
  requestId: string;
}
