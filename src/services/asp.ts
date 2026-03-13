import type {
  ChainConfig,
  MtRootsResponse,
  MtLeavesResponse,
  AspEventsPageResponse,
  PoolStatisticsResponse,
  GlobalStatisticsResponse,
} from "../types.js";
import { CLIError } from "../utils/errors.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";
import {
  isTransientNetworkError,
  retryWithBackoff,
  overrideRetryWaitForTests,
} from "../utils/network.js";

const ASP_MAX_RETRIES = 3;
const ASP_RETRY_BASE_DELAY_MS = 500;

class RetryableAspHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Retryable ASP HTTP ${status}`);
    this.name = "RetryableAspHttpError";
  }
}

export function overrideAspRetryWaitForTests(
  waitFn?: (ms: number) => Promise<void>
): void {
  overrideRetryWaitForTests(waitFn);
}

function genericAspUnavailableError(retryable: boolean = false): CLIError {
  return new CLIError(
    "Could not reach the ASP service.",
    "ASP",
    "Check your network connection. If it persists, the service may be temporarily down.",
    undefined,
    retryable
  );
}

function isRetryableAspError(error: unknown): boolean {
  return error instanceof RetryableAspHttpError || isTransientNetworkError(error);
}

const aspRetryConfig = {
  maxRetries: ASP_MAX_RETRIES,
  delayMs: (attempt: number) => ASP_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)),
  isRetryable: isRetryableAspError,
  onExhausted: (error: unknown): never => {
    if (error instanceof RetryableAspHttpError) {
      throw genericAspUnavailableError(true);
    }
    throw error;
  },
} as const;

async function runAspRequestWithRetry(
  request: () => Promise<Response>
): Promise<Response> {
  return retryWithBackoff(request, aspRetryConfig);
}

async function aspFetch(
  chainConfig: ChainConfig,
  path: string,
  scope?: bigint,
  query?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${chainConfig.aspHost}/${chainConfig.id}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {};
  if (scope !== undefined) {
    // Must be decimal string, never hex
    headers["X-Pool-Scope"] = scope.toString();
  }

  return runAspRequestWithRetry(async () => {
    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(getNetworkTimeoutMs()),
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new CLIError(
          "ASP service: resource not found.",
          "ASP",
          "The pool may not be registered yet. Run 'privacy-pools pools' to verify."
        );
      }
      if (res.status === 400) {
        throw new CLIError(
          "ASP service returned an error.",
          "ASP",
          "Try 'privacy-pools sync' and retry. If it persists, the CLI may be out of date."
        );
      }
      if (res.status === 429 || res.status === 403) {
        throw new CLIError(
          "ASP service is temporarily rate-limiting requests.",
          "ASP",
          "Wait a moment and try again."
        );
      }
      if (res.status >= 500) {
        throw new RetryableAspHttpError(res.status);
      }
      throw genericAspUnavailableError();
    }

    return res;
  });
}

async function aspFetchGlobal(
  chainConfig: ChainConfig,
  path: string,
  query?: Record<string, string>
): Promise<Response> {
  const url = new URL(`${chainConfig.aspHost}/global${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  return runAspRequestWithRetry(async () => {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(getNetworkTimeoutMs()),
    });

    if (!res.ok) {
      if (res.status === 429 || res.status === 403) {
        throw new CLIError(
          "ASP service is temporarily rate-limiting requests.",
          "ASP",
          "Wait a moment and try again."
        );
      }
      if (res.status >= 500) {
        throw new RetryableAspHttpError(res.status);
      }
      throw genericAspUnavailableError();
    }

    return res;
  });
}

export async function fetchMerkleRoots(
  chainConfig: ChainConfig,
  scope: bigint
): Promise<MtRootsResponse> {
  const res = await aspFetch(chainConfig, "/public/mt-roots", scope);
  return res.json();
}

export async function fetchMerkleLeaves(
  chainConfig: ChainConfig,
  scope: bigint
): Promise<MtLeavesResponse> {
  const res = await aspFetch(chainConfig, "/public/mt-leaves", scope);
  return res.json();
}

export async function fetchPoolEvents(
  chainConfig: ChainConfig,
  scope: bigint,
  page: number,
  perPage: number
): Promise<AspEventsPageResponse> {
  const res = await aspFetch(chainConfig, "/public/events", scope, {
    page: String(page),
    perPage: String(perPage),
  });
  return res.json();
}

export async function fetchGlobalEvents(
  chainConfig: ChainConfig,
  page: number,
  perPage: number
): Promise<AspEventsPageResponse> {
  const res = await aspFetchGlobal(chainConfig, "/public/events", {
    page: String(page),
    perPage: String(perPage),
  });
  return res.json();
}

export interface PoolStatsEntry {
  scope: string;
  chainId?: number;
  totalInPoolValue?: string;
  totalInPoolValueUsd?: string;
  totalDepositsValue?: string;
  totalDepositsValueUsd?: string;
  acceptedDepositsValue?: string;
  acceptedDepositsValueUsd?: string;
  totalDepositsCount?: number;
  acceptedDepositsCount?: number;
  pendingDepositsValue?: string;
  pendingDepositsValueUsd?: string;
  pendingDepositsCount?: number;
  growth24h?: number | null;
  pendingGrowth24h?: number | null;
  tokenAddress?: string;
  assetAddress?: string;
  tokenSymbol?: string;
  [key: string]: unknown;
}

export async function fetchPoolsStats(
  chainConfig: ChainConfig
): Promise<
  PoolStatsEntry[]
  | { pools?: PoolStatsEntry[]; [scope: string]: PoolStatsEntry | PoolStatsEntry[] | undefined }
> {
  const res = await aspFetch(chainConfig, "/public/pools-stats");
  return res.json();
}

export async function fetchDepositsLargerThan(
  chainConfig: ChainConfig,
  scope: bigint,
  amount: bigint
): Promise<{ eligibleDeposits: number; totalDeposits: number; percentage: number }> {
  const res = await aspFetch(
    chainConfig,
    "/public/deposits-larger-than",
    scope,
    { amount: amount.toString() }
  );
  return res.json();
}

export async function fetchPoolStatistics(
  chainConfig: ChainConfig,
  scope: bigint
): Promise<PoolStatisticsResponse> {
  const res = await aspFetch(chainConfig, "/public/pool-statistics", scope);
  return res.json();
}

export async function fetchGlobalStatistics(
  chainConfig: ChainConfig
): Promise<GlobalStatisticsResponse> {
  const res = await aspFetchGlobal(chainConfig, "/public/statistics");
  return res.json();
}

/**
 * Fetch ASP leaves and return a Set of approved labels for a pool.
 * Returns null if the ASP is unreachable (non-fatal).
 */
export async function fetchApprovedLabels(
  chainConfig: ChainConfig,
  scope: bigint
): Promise<Set<string> | null> {
  try {
    const res = await aspFetch(chainConfig, "/public/mt-leaves", scope);
    const { aspLeaves } = (await res.json()) as { aspLeaves: string[] };
    return new Set(aspLeaves.map((leaf) => BigInt(leaf).toString()));
  } catch {
    return null;
  }
}

export async function checkLiveness(chainConfig: ChainConfig): Promise<boolean> {
  try {
    const res = await fetch(
      `${chainConfig.aspHost}/${chainConfig.id}/health/liveness`,
      { signal: AbortSignal.timeout(Math.min(getNetworkTimeoutMs(), 10_000)) }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}
