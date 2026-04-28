import type {
  ChainConfig,
  MtRootsResponse,
  MtLeavesResponse,
  AspEventsPageResponse,
  PoolStatisticsResponse,
  GlobalStatisticsResponse,
} from "../types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./config.js";
import { CLIError } from "../utils/errors.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";
import {
  normalizeAspApprovalStatus,
  type AspApprovalStatus,
} from "../utils/statuses.js";
import {
  isTransientNetworkError,
  retryWithBackoff,
} from "../utils/network.js";
import type { RetryConfig } from "../utils/network.js";
import {
  elapsedRuntimeMs,
  emitRuntimeDiagnostic,
  runtimeStopwatch,
} from "../runtime/diagnostics.js";

const ASP_MAX_RETRIES = 3;
const ASP_RETRY_BASE_DELAY_MS = 500;
const POOLS_STATS_CACHE_TTL_MS = 5 * 60 * 1000;

class RetryableAspHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Retryable ASP HTTP ${status}`);
    this.name = "RetryableAspHttpError";
  }
}

let aspWaitFn: RetryConfig["waitFn"];

/**
 * Override the retry wait function for ASP tests only.
 * Does not affect relayer retry timing.
 * Call with no argument to restore the default.
 */
export function overrideAspRetryWaitForTests(
  waitFn?: (ms: number) => Promise<void>
): void {
  aspWaitFn = waitFn;
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

function aspRetryConfig(): RetryConfig {
  return {
    maxRetries: ASP_MAX_RETRIES,
    delayMs: (attempt: number) => ASP_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)),
    isRetryable: isRetryableAspError,
    onExhausted: (error: unknown): never => {
      if (error instanceof RetryableAspHttpError) {
        throw genericAspUnavailableError(true);
      }
      throw error;
    },
    waitFn: aspWaitFn,
  };
}

async function runAspRequestWithRetry(
  request: () => Promise<Response>
): Promise<Response> {
  return retryWithBackoff(request, aspRetryConfig());
}

async function aspFetch(
  chainConfig: ChainConfig,
  path: string,
  scope?: bigint,
  query?: Record<string, string>,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const startedAt = runtimeStopwatch();
  const url = new URL(`${chainConfig.aspHost}/${chainConfig.id}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
  if (scope !== undefined) {
    // Must be decimal string, never hex
    headers["X-Pool-Scope"] = scope.toString();
  }

  try {
    const response = await runAspRequestWithRetry(async () => {
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

    emitRuntimeDiagnostic("asp-latency", {
      chain: chainConfig.name,
      path,
      scope: scope?.toString(),
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "ok",
    });

    return response;
  } catch (error) {
    emitRuntimeDiagnostic("asp-latency", {
      chain: chainConfig.name,
      path,
      scope: scope?.toString(),
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "error",
      errorCategory: error instanceof CLIError ? error.category : undefined,
    });
    throw error;
  }
}

async function aspFetchGlobal(
  chainConfig: ChainConfig,
  path: string,
  query?: Record<string, string>
): Promise<Response> {
  const startedAt = runtimeStopwatch();
  const url = new URL(`${chainConfig.aspHost}/global${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  try {
    const response = await runAspRequestWithRetry(async () => {
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

    emitRuntimeDiagnostic("asp-latency", {
      chain: chainConfig.name,
      path: `global${path}`,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "ok",
    });

    return response;
  } catch (error) {
    emitRuntimeDiagnostic("asp-latency", {
      chain: chainConfig.name,
      path: `global${path}`,
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      outcome: "error",
      errorCategory: error instanceof CLIError ? error.category : undefined,
    });
    throw error;
  }
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

type PoolsStatsResponse =
  | PoolStatsEntry[]
  | { pools?: PoolStatsEntry[]; [scope: string]: PoolStatsEntry | PoolStatsEntry[] | undefined };

function poolsStatsCachePath(chainConfig: ChainConfig): string {
  const cacheDir = join(getConfigDir(), "cache");
  return join(
    cacheDir,
    `pools-stats-${chainConfig.id}-${encodeURIComponent(chainConfig.aspHost)}.json`,
  );
}

function readCachedPoolsStats(chainConfig: ChainConfig): PoolsStatsResponse | null {
  const filePath = poolsStatsCachePath(chainConfig);
  if (!existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      fetchedAt?: unknown;
      data?: unknown;
    };
    if (
      typeof parsed.fetchedAt !== "number" ||
      Date.now() - parsed.fetchedAt > POOLS_STATS_CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed.data as PoolsStatsResponse;
  } catch {
    return null;
  }
}

function writeCachedPoolsStats(
  chainConfig: ChainConfig,
  data: PoolsStatsResponse,
): void {
  const filePath = poolsStatsCachePath(chainConfig);
  try {
    mkdirSync(join(getConfigDir(), "cache"), { recursive: true, mode: 0o700 });
    writeFileSync(
      filePath,
      JSON.stringify({ fetchedAt: Date.now(), data }),
      { mode: 0o600 },
    );
  } catch {
    // Best effort: cache misses should never block pool discovery.
  }
}

export async function fetchPoolsStats(
  chainConfig: ChainConfig
): Promise<PoolsStatsResponse> {
  const cached = readCachedPoolsStats(chainConfig);
  if (cached) {
    return cached;
  }
  const res = await aspFetch(chainConfig, "/public/pools-stats");
  const data = await res.json() as PoolsStatsResponse;
  writeCachedPoolsStats(chainConfig, data);
  return data;
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

interface AspDepositStatusRow {
  label?: string;
  reviewStatus?: string;
}

export interface LoadedAspDepositReviewState {
  approvedLabels: Set<string> | null;
  rawReviewStatuses: Map<string, string> | null;
  reviewStatuses: Map<string, AspApprovalStatus> | null;
  hasIncompleteReviewData: boolean;
}

export function formatIncompleteAspReviewDataMessage(
  context: "accounts" | "pool-detail" | "ragequit",
  chainName?: string,
): string {
  switch (context) {
    case "accounts":
      return "Some ASP review data was unavailable or incomplete; non-approved deposits may appear as unknown, and --pending-only results may miss pending, declined, or POA Needed accounts until the ASP catches up.";
    case "pool-detail":
      return "Some ASP review data was unavailable or incomplete; some Pool Account review states may appear as unknown until the ASP catches up.";
    case "ragequit":
      return `Some ASP review data was unavailable or incomplete${chainName ? ` on ${chainName}` : ""}; a Pool Account may appear as unknown even when the ASP would normally report pending, declined, or POA Needed. Re-run 'privacy-pools accounts${chainName ? ` --chain ${chainName}` : ""}' if you need the exact review state before choosing withdraw or ragequit.`;
  }
}

export function normalizeDepositReviewStatuses(
  rawReviewStatuses: ReadonlyMap<string, string> | null,
): Map<string, AspApprovalStatus> | null {
  if (rawReviewStatuses === null) return null;

  return new Map(
    Array.from(rawReviewStatuses.entries()).map(([label, status]) => [
      label,
      normalizeAspApprovalStatus(status),
    ]),
  );
}

export function hasIncompleteDepositReviewData(
  labels: readonly string[],
  approvedLabels: Set<string> | null,
  reviewStatuses: ReadonlyMap<string, unknown> | null,
): boolean {
  if (labels.length === 0) return false;
  if (approvedLabels === null || reviewStatuses === null) return true;
  return labels.some((label) => !reviewStatuses.has(label));
}

export function buildLoadedAspDepositReviewState(
  labels: readonly string[],
  approvedLabels: Set<string> | null,
  rawReviewStatuses: Map<string, string> | null,
): LoadedAspDepositReviewState {
  if (labels.length === 0) {
    return {
      approvedLabels: new Set<string>(),
      rawReviewStatuses: new Map<string, string>(),
      reviewStatuses: new Map<string, AspApprovalStatus>(),
      hasIncompleteReviewData: false,
    };
  }

  return {
    approvedLabels,
    rawReviewStatuses,
    reviewStatuses: normalizeDepositReviewStatuses(rawReviewStatuses),
    hasIncompleteReviewData: hasIncompleteDepositReviewData(
      labels,
      approvedLabels,
      rawReviewStatuses,
    ),
  };
}

/**
 * Fetch per-label ASP review statuses for active deposits with remaining balance.
 * Returns null when the endpoint is unavailable so callers can fail closed
 * for non-approved deposits instead of guessing between pending, declined,
 * and PoA-needed states.
 */
export async function fetchDepositReviewStatuses(
  chainConfig: ChainConfig,
  scope: bigint,
  labels: string[],
): Promise<Map<string, string> | null> {
  if (labels.length === 0) return new Map();

  try {
    const res = await aspFetch(
      chainConfig,
      "/public/deposits-by-label",
      scope,
      undefined,
      { "X-Labels": labels.join(",") },
    );
    const rows = await res.json() as AspDepositStatusRow[];
    const reviewStatuses = new Map<string, string>();

    for (const row of rows) {
      if (typeof row.label !== "string" || typeof row.reviewStatus !== "string") continue;
      reviewStatuses.set(BigInt(row.label).toString(), row.reviewStatus);
    }

    return reviewStatuses;
  } catch {
    return null;
  }
}

export async function loadAspDepositReviewState(
  chainConfig: ChainConfig,
  scope: bigint,
  labels: string[],
): Promise<LoadedAspDepositReviewState> {
  const [approvedLabels, rawReviewStatuses] = labels.length === 0
    ? [new Set<string>(), new Map<string, string>()]
    : await Promise.all([
    fetchApprovedLabels(chainConfig, scope),
    fetchDepositReviewStatuses(chainConfig, scope, labels),
  ]);

  return buildLoadedAspDepositReviewState(labels, approvedLabels, rawReviewStatuses);
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
