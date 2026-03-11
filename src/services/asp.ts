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

/** Maximum number of retries for transient (5xx / network) ASP failures. */
const ASP_MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff between retries. */
const ASP_RETRY_BASE_DELAY_MS = 500;

/**
 * Returns true for errors that are worth retrying: 5xx status codes and
 * network-level failures (timeouts, connection refused, etc.).
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof CLIError) {
    // 4xx errors are mapped to specific CLIError messages before this point;
    // only the generic "Could not reach" fallback (used for 5xx) is retryable.
    return error.message === "Could not reach the ASP service.";
  }
  // Network-level failures (timeout, DNS, connection refused)
  return error instanceof Error && (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    error.message.includes("fetch") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("ETIMEDOUT") ||
    error.message.includes("ENOTFOUND")
  );
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

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= ASP_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1000ms, 2000ms
      const delay = ASP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }

    try {
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
        throw new CLIError(
          "Could not reach the ASP service.",
          "ASP",
          "Check your network connection. If it persists, the service may be temporarily down."
        );
      }

      return res;
    } catch (error) {
      if (error instanceof Error && isTransientError(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  // All retries exhausted — throw the last transient error
  throw lastError!;
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
    throw new CLIError(
      "Could not reach the ASP service.",
      "ASP",
      "Check your network connection. If it persists, the service may be temporarily down."
    );
  }

  return res;
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
