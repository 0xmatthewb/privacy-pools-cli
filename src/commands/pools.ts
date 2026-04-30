import type { Command } from "commander";
import type { Address } from "viem";
import {
  getDefaultReadOnlyChains,
  getAllChainsWithOverrides,
  MULTI_CHAIN_SCOPE_ALL_CHAINS,
  MULTI_CHAIN_SCOPE_ALL_MAINNETS,
} from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { listPools, resolvePool } from "../services/pools.js";
import { loadMnemonic } from "../services/wallet.js";
import { loadAccount } from "../services/account-storage.js";
import { getDataService } from "../services/sdk.js";
import {
  initializeAccountService,
  loadSyncMeta,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import {
  fetchGlobalEvents,
  fetchGlobalStatistics,
  fetchPoolEvents,
  fetchPoolStatistics,
  formatIncompleteAspReviewDataMessage,
  loadAspDepositReviewState,
} from "../services/asp.js";
import {
  spinner,
  formatAmount,
  displayDecimals,
  deriveTokenPrice,
  verbose,
} from "../utils/format.js";
import { CLIError, classifyError, printError } from "../utils/errors.js";
import { inputError } from "../utils/errors/factories.js";
import {
  buildPoolAccountRefs,
  collectActiveLabels,
} from "../utils/pool-accounts.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
import type {
  ChainConfig,
  GlobalOptions,
  GlobalStatisticsResponse,
  PoolStatisticsResponse,
  PoolStats,
  AspPublicEvent,
} from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  normalizeActivityEvent,
  parseNumberish as parseNumberishValue,
} from "../utils/public-activity.js";
import {
  SUPPORTED_SORT_MODES,
  type PoolsSortMode,
} from "../utils/pools-sort.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import { createOutputContext, isSilent } from "../output/common.js";
import {
  renderPoolsEmpty,
  renderPools,
  renderPoolDetail,
} from "../output/pools.js";
import { renderActivity } from "../output/activity.js";
import { renderGlobalStats, renderPoolStats } from "../output/stats.js";
import type {
  PoolDetailActivityEvent,
  PoolWithChain,
  PoolsRenderData,
} from "../output/pools.js";

interface PoolsCommandOptions {
  includeTestnets?: boolean;
  limit?: string;
  search?: string;
  sort?: string;
}

interface PoolsActivityCommandOptions {
  includeTestnets?: boolean;
  page?: string;
  limit?: string;
}

interface PoolsStatsCommandOptions {}

interface ChainPoolsResult {
  chainConfig: ChainConfig;
  pools: PoolStats[];
  error?: unknown;
}

export { createPoolsCommand } from "../command-shells/pools.js";
export { parseUsd, parseCount } from "../output/stats.js";
export { parseNumberishValue as parseNumberish };

function parseSortMode(raw: string | undefined): PoolsSortMode {
  const normalized = raw?.trim().toLowerCase() ?? "default";
  if ((SUPPORTED_SORT_MODES as readonly string[]).includes(normalized)) {
    return normalized as PoolsSortMode;
  }
  throw inputError(
    "INPUT_INVALID_VALUE",
    `Invalid --sort value: ${raw}.`,
    `Use one of: ${SUPPORTED_SORT_MODES.join(", ")}.`,
  );
}

function parseOptionalLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw inputError(
      "INPUT_INVALID_VALUE",
      `Invalid --limit value: ${raw}.`,
      "--limit must be a positive integer.",
    );
  }
  return parsed;
}

export function parsePositiveInt(
  raw: string | undefined,
  fieldName: string,
): number {
  const fallback = fieldName === "page" ? 1 : 12;
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw inputError(
      "INPUT_INVALID_VALUE",
      `Invalid --${fieldName} value: ${raw}.`,
      `--${fieldName} must be a positive integer.`,
    );
  }
  return parsed;
}

function normalizeAspPage(
  rawPage: number | null,
  requestedPage: number,
): number {
  if (rawPage === null) return requestedPage;
  if (requestedPage > 0 && rawPage === requestedPage - 1) {
    return rawPage + 1;
  }
  return rawPage <= 0 ? requestedPage : rawPage;
}

function deriveKnownTotalPages(
  total: number | null,
  perPage: number,
  reportedTotalPages: number | null,
): number | null {
  if (total !== null && perPage > 0) {
    return Math.max(1, Math.ceil(total / perPage));
  }
  return reportedTotalPages;
}

function getRootGlobalOptions(cmd: Command): GlobalOptions {
  const withGlobals = (cmd as Command & {
    optsWithGlobals?: () => Record<string, unknown>;
  }).optsWithGlobals;
  if (typeof withGlobals === "function") {
    return withGlobals.call(cmd) as GlobalOptions;
  }

  return (cmd.parent?.parent?.opts() ??
    cmd.parent?.opts?.() ??
    {}) as GlobalOptions;
}

function poolFundsMetric(pool: PoolStats): bigint {
  return pool.totalInPoolValue ?? pool.acceptedDepositsValue ?? 0n;
}

function parseUsdMetric(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTokenMetric(pool: PoolStats, value: bigint): bigint {
  const targetDecimals = 18;
  if (pool.decimals === targetDecimals) {
    return value;
  }
  if (pool.decimals < targetDecimals) {
    return value * 10n ** BigInt(targetDecimals - pool.decimals);
  }
  return value / 10n ** BigInt(pool.decimals - targetDecimals);
}

function comparePoolValueMetric(
  left: PoolStats,
  right: PoolStats,
  selectUsd: (pool: PoolStats) => string | undefined | null,
  selectValue: (pool: PoolStats) => bigint | undefined,
): number {
  const leftUsd = parseUsdMetric(selectUsd(left));
  const rightUsd = parseUsdMetric(selectUsd(right));
  if (leftUsd !== null || rightUsd !== null) {
    if (leftUsd === null) return -1;
    if (rightUsd === null) return 1;
    if (leftUsd < rightUsd) return -1;
    if (leftUsd > rightUsd) return 1;
    return 0;
  }

  const leftValue = normalizeTokenMetric(left, selectValue(left) ?? 0n);
  const rightValue = normalizeTokenMetric(right, selectValue(right) ?? 0n);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function poolDepositsMetric(pool: PoolStats): number {
  return pool.totalDepositsCount ?? 0;
}

function withChainMeta(
  chainConfig: ChainConfig,
  pools: PoolStats[],
): PoolWithChain[] {
  return pools.map((pool) => ({
    chain: chainConfig.name,
    chainId: chainConfig.id,
    pool,
  }));
}

function countCachedPoolAccountsForScope(
  chainId: number,
  scope: bigint,
): number | undefined {
  try {
    const account = loadAccount(chainId);
    if (!account || !(account.poolAccounts instanceof Map)) {
      return 0;
    }

    const scopeEntries = account.poolAccounts.get(scope);
    if (!Array.isArray(scopeEntries)) {
      return 0;
    }

    let total = 0;
    for (const entry of scopeEntries) {
      const rawEntry = entry as {
        ragequit?: boolean;
        commitments?: Array<{ value?: bigint }>;
      };
      if (rawEntry.ragequit === true) continue;
      const commitments = Array.isArray(rawEntry.commitments)
        ? rawEntry.commitments
        : [];
      const latestCommitment = commitments.at(-1);
      const remainingValue = latestCommitment?.value;
      if (typeof remainingValue === "bigint" && remainingValue > 0n) {
        total += 1;
      }
    }

    return total;
  } catch {
    return undefined;
  }
}

function enrichPoolsWithCachedAccountCounts(
  pools: PoolWithChain[],
): PoolWithChain[] {
  return pools.map((entry) => ({
    ...entry,
    myPoolAccountsCount: countCachedPoolAccountsForScope(
      entry.chainId,
      entry.pool.scope,
    ),
  }));
}

function isPoolDetailInitRequiredError(error: unknown): boolean {
  const classified = classifyError(error);
  return (
    classified.category === "INPUT" &&
    classified.message.includes("No recovery phrase found")
  );
}

export function formatPoolDetailMyFundsWarning(
  error: unknown,
  chainName: string,
): string {
  const classified = classifyError(error);
  const diagnosticsCmd = `privacy-pools status --check --chain ${chainName}`;

  if (classified.category === "RPC") {
    return (
      "Could not load your wallet state from onchain data right now. " +
      `Check your RPC connection and try again, or run '${diagnosticsCmd}'.`
    );
  }

  if (classified.category === "ASP") {
    return (
      "Could not load ASP-backed wallet review data right now. " +
      `Pool stats are still available; retry shortly or run '${diagnosticsCmd}'.`
    );
  }

  if (
    classified.category === "INPUT" &&
    classified.message.includes(
      "Stored recovery phrase is invalid or corrupted",
    )
  ) {
    return (
      "Could not load your wallet state right now because the stored recovery phrase " +
      "looks invalid or corrupted. Re-import it with 'privacy-pools init --force' if needed."
    );
  }

  if (classified.category === "INPUT") {
    return (
      "Could not load your local wallet state right now. " +
      `Check your local setup and run '${diagnosticsCmd}' for more details.`
    );
  }

  return (
    "Could not load your wallet state right now. " +
    `Pool stats and recent activity are still available. Try again, or run '${diagnosticsCmd}'.`
  );
}

function applySearch(
  pools: PoolWithChain[],
  query: string | undefined,
): PoolWithChain[] {
  const terms = (query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return pools;

  return pools.filter((entry) => {
    const haystack = [
      entry.chain,
      entry.chainId.toString(),
      entry.pool.symbol,
      entry.pool.asset,
      entry.pool.pool,
      entry.pool.scope.toString(),
    ]
      .join(" ")
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

function sortPools(
  pools: PoolWithChain[],
  mode: PoolsSortMode,
): PoolWithChain[] {
  if (mode === "default") return pools;

  const sorted = [...pools];
  sorted.sort((left, right) => {
    let diff = 0;
    switch (mode) {
      case "asset-asc":
        diff = left.pool.symbol.localeCompare(right.pool.symbol);
        break;
      case "asset-desc":
        diff = right.pool.symbol.localeCompare(left.pool.symbol);
        break;
      case "tvl-desc": {
        diff = comparePoolValueMetric(
          right.pool,
          left.pool,
          (pool) => pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd,
          (pool) => poolFundsMetric(pool),
        );
        break;
      }
      case "tvl-asc": {
        diff = comparePoolValueMetric(
          left.pool,
          right.pool,
          (pool) => pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd,
          (pool) => poolFundsMetric(pool),
        );
        break;
      }
      case "deposits-desc":
        diff = poolDepositsMetric(right.pool) - poolDepositsMetric(left.pool);
        break;
      case "deposits-asc":
        diff = poolDepositsMetric(left.pool) - poolDepositsMetric(right.pool);
        break;
      case "chain-asset": {
        diff = left.chain.localeCompare(right.chain);
        if (diff === 0)
          diff = left.pool.symbol.localeCompare(right.pool.symbol);
        break;
      }
      default:
        diff = 0;
    }

    if (diff !== 0) return diff;
    const byChain = left.chain.localeCompare(right.chain);
    if (byChain !== 0) return byChain;
    const bySymbol = left.pool.symbol.localeCompare(right.pool.symbol);
    if (bySymbol !== 0) return bySymbol;
    return left.pool.pool.localeCompare(right.pool.pool);
  });

  return sorted;
}

async function renderPoolDetailForAsset(
  asset: string,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);
  const silent = isSilent(ctx) || mode.isWide;
  const isVerbose = globalOpts?.verbose ?? false;

  try {
    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);

    const spin = spinner(
      `Fetching ${asset} pool details on ${chainConfig.name}...`,
      silent,
    );
    if (
      await maybeRenderPreviewProgressStep("pools.detail.fetch", {
        spinnerText: `Fetching ${asset} pool details on ${chainConfig.name}...`,
        doneText: `${asset} pool details loaded.`,
      })
    ) {
      return;
    }
    spin.start();

    const pool = await resolvePool(chainConfig, asset, globalOpts?.rpcUrl);
    const tokenPrice = deriveTokenPrice(pool);

    // Try to load wallet and accounts (non-fatal).
    let walletState: "available" | "setup_required" | "load_failed" = "setup_required";
    let myPoolAccounts: PoolAccountRef[] | null = null;
    let myFundsWarning: string | null = null;
    const lastSyncTime = loadSyncMeta(chainConfig.id)?.lastSyncTime ?? null;
    try {
      const mnemonic = loadMnemonic();
      const dataService = await getDataService(
        chainConfig,
        pool.pool,
        globalOpts?.rpcUrl,
      );
      const accountService = await initializeAccountService(
        dataService,
        mnemonic,
        [
          {
            chainId: chainConfig.id,
            address: pool.pool as Address,
            scope: pool.scope,
            deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
          },
        ],
        chainConfig.id,
        true,
        true,
        true,
      );
      const spendable = withSuppressedSdkStdoutSync(() =>
        accountService.getSpendableCommitments(),
      );
      const poolCommitments = spendable.get(pool.scope) ?? [];
      const activeLabels = collectActiveLabels(poolCommitments);
      const aspReviewState = await loadAspDepositReviewState(
        chainConfig,
        pool.scope,
        activeLabels,
      );
      if (aspReviewState.hasIncompleteReviewData) {
        myFundsWarning = formatIncompleteAspReviewDataMessage("pool-detail");
      }
      myPoolAccounts = buildPoolAccountRefs(
        accountService.account,
        pool.scope,
        poolCommitments,
        aspReviewState.approvedLabels,
        aspReviewState.reviewStatuses,
      );
      walletState = "available";
    } catch (error) {
      if (isPoolDetailInitRequiredError(error)) {
        walletState = "setup_required";
      } else {
        walletState = "load_failed";
        const classified = classifyError(error);
        verbose(
          `Pool detail wallet-state load failed: ${classified.code}: ${classified.message}` +
            (classified.hint ? ` | ${classified.hint}` : ""),
          isVerbose,
          silent,
        );
        myFundsWarning = formatPoolDetailMyFundsWarning(
          error,
          chainConfig.name,
        );
      }
    }

    // Try to fetch recent activity (non-fatal).
    let recentActivity: PoolDetailActivityEvent[] | null = null;
    let recentActivityUnavailable = false;
    try {
      const eventsPage = await fetchPoolEvents(chainConfig, pool.scope, 1, 5);
      const events = Array.isArray(eventsPage.events)
        ? eventsPage.events
        : [];
      recentActivity = events.map((event: AspPublicEvent) => {
        const normalized = normalizeActivityEvent(
          event,
          pool.symbol,
          pool.decimals,
        );
        return {
          type: normalized.type,
          amount: normalized.amountFormatted,
          amountRaw: normalized.amountRaw,
          timeLabel: normalized.timeLabel,
          timestamp: normalized.timestampMs === null
            ? null
            : new Date(normalized.timestampMs).toISOString(),
          txHash: normalized.txHash,
          status: normalized.reviewStatus,
        };
      });
    } catch {
      recentActivityUnavailable = true;
    }

    spin.stop();

    renderPoolDetail(ctx, {
      chain: chainConfig.name,
      requestedChain: globalOpts?.chain && globalOpts.chain !== chainConfig.name
        ? globalOpts.chain
        : null,
      pool,
      tokenPrice,
      walletState,
      myPoolAccounts,
      myFundsWarning,
      lastSyncTime,
      recentActivity,
      recentActivityUnavailable,
    });
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handlePoolsCommand(
  asset: string | undefined,
  opts: PoolsCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);
  const silent = isSilent(ctx) || mode.isWide;
  const isVerbose = globalOpts?.verbose ?? false;

  if (await maybeRenderPreviewScenario("pools")) {
    return;
  }

  if (asset) {
    printError(
      inputError(
        "INPUT_UNKNOWN_COMMAND",
        `Pool detail moved to 'pools show'.`,
        `Use: privacy-pools pools show ${asset}`,
      ),
      mode.isJson,
    );
    return;
  }

  // ── Listing view ──────────────────────────────────────────────────
  try {
    const explicitChain = globalOpts?.chain;
    const includeTestnets = opts.includeTestnets === true;
    const isMultiChain = includeTestnets || !explicitChain;

    if (isMultiChain && globalOpts?.rpcUrl) {
      throw inputError(
        "INPUT_FLAG_CONFLICT",
        "--rpc-url cannot be combined with multi-chain queries.",
        "Use --chain <name> to target a single chain with --rpc-url.",
      );
    }

    const config = loadConfig();
    const sortMode = parseSortMode(opts.sort);
    const limit = parseOptionalLimit(opts.limit);
    const searchQuery = opts.search?.trim();

    let chainsToQuery: ChainConfig[];
    if (includeTestnets) {
      chainsToQuery = getAllChainsWithOverrides();
    } else if (explicitChain) {
      chainsToQuery = [resolveChain(explicitChain, config.defaultChain)];
    } else {
      chainsToQuery = getDefaultReadOnlyChains();
    }

    const spin = spinner(
      isMultiChain
        ? "Fetching pools across chains..."
        : `Fetching pools for ${chainsToQuery[0].name}...`,
      silent,
    );
    if (
      await maybeRenderPreviewProgressStep("pools.list.fetch", {
        spinnerText: isMultiChain
          ? "Fetching pools across chains..."
          : `Fetching pools for ${chainsToQuery[0].name}...`,
        doneText: "Pool list loaded.",
      })
    ) {
      return;
    }
    spin.start();

    let chainsCompleted = 0;
    const chainResults: ChainPoolsResult[] = await Promise.all(
      chainsToQuery.map(async (chainConfig) => {
        try {
          const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
          return { chainConfig, pools };
        } catch (error) {
          return { chainConfig, pools: [], error };
        } finally {
          if (isMultiChain && chainsToQuery.length > 1) {
            chainsCompleted++;
            spin.text = `Fetching pools... (${chainsCompleted}/${chainsToQuery.length} chains done)`;
          }
        }
      }),
    );
    spin.stop();

    const warnings = chainResults
      .filter((result) => result.error !== undefined)
      .map((result) => {
        const classified = classifyError(result.error);
        return {
          chain: result.chainConfig.name,
          category: classified.category,
          message: classified.message,
        };
      });

    const rawPools = enrichPoolsWithCachedAccountCounts(chainResults.flatMap((result) =>
      withChainMeta(result.chainConfig, result.pools),
    ));

    const renderData: PoolsRenderData = {
      allChains: isMultiChain,
      chainName: chainsToQuery[0].name,
      requestedChain: explicitChain && explicitChain !== chainsToQuery[0].name
        ? explicitChain
        : null,
      multiChainLabel: chainResults.some((result) => result.chainConfig.isTestnet)
        ? "all-chains"
        : "all-mainnets",
      search: searchQuery ?? null,
      sort: sortMode,
      filteredPools: [],
      warnings,
    };

    if (isMultiChain) {
      renderData.chainSummaries = chainResults.map((result) => ({
        chain: result.chainConfig.name,
        pools: result.pools.length,
        error: result.error ? classifyError(result.error).message : null,
      }));
    }

    if (rawPools.length === 0) {
      const firstFailure = chainResults.find(
        (result) => result.error !== undefined,
      );
      if (firstFailure?.error !== undefined) {
        throw firstFailure.error;
      }

      renderPoolsEmpty(ctx, renderData);
      return;
    }

    const filteredPools = sortPools(
      applySearch(rawPools, searchQuery),
      sortMode,
    );
    renderData.filteredPools = limit === undefined
      ? filteredPools
      : filteredPools.slice(0, limit);

    renderPools(ctx, renderData);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handlePoolsListAliasCommand(
  opts: PoolsCommandOptions,
  cmd: Command,
): Promise<void> {
  await handlePoolsCommand(undefined, opts, cmd);
}

export async function handlePoolsShowCommand(
  asset: string,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await renderPoolDetailForAsset(asset, cmd);
}

export async function handlePoolsActivityCommand(
  positionalAsset: string | undefined,
  opts: PoolsActivityCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const isQuiet = mode.isQuiet;
  const silent = isQuiet || isJson || mode.isWide;

  const resolvedAsset = positionalAsset;
  try {
    if (await maybeRenderPreviewScenario("activity")) {
      return;
    }

    const page = parsePositiveInt(opts.page, "page");
    const perPage = parsePositiveInt(opts.limit, "limit");
    const explicitChain = globalOpts?.chain;
    const includeTestnets = opts.includeTestnets === true;

    const config = loadConfig();
    const ctx = createOutputContext(mode);
    if (
      await maybeRenderPreviewProgressStep("activity.fetch", {
        spinnerText: "Fetching public activity...",
        doneText: "Activity loaded.",
      })
    ) {
      return;
    }
    const spin = spinner("Fetching public activity...", silent);
    spin.start();

    // Asset filter requires a single chain for pool resolution.
    if (resolvedAsset) {
      const chainConfig = resolveChain(explicitChain, config.defaultChain);
      const pool = await resolvePool(
        chainConfig,
        resolvedAsset,
        globalOpts?.rpcUrl,
      );
      const response = await fetchPoolEvents(
        chainConfig,
        pool.scope,
        page,
        perPage,
      );
      spin.stop();

      const eventsRaw = Array.isArray(response.events) ? response.events : [];
      const events = eventsRaw.map((event) =>
        normalizeActivityEvent(event, pool.symbol),
      );
      const responsePerPage = parseNumberishValue(response.perPage) ?? perPage;
      const total = parseNumberishValue(response.total) ?? null;
      const totalPages = deriveKnownTotalPages(
        total,
        responsePerPage,
        parseNumberishValue(response.totalPages) ?? null,
      );

      renderActivity(ctx, {
        mode: "pool-activity",
        chain: chainConfig.name,
        page: normalizeAspPage(parseNumberishValue(response.page), page),
        perPage: responsePerPage,
        total,
        totalPages,
        events,
        asset: pool.symbol,
        pool: pool.pool,
        scope: pool.scope.toString(),
      });
      return;
    }

    // Global activity: the ASP global endpoint returns cross-chain data,
    // so call it exactly once per ASP host.
    if (!explicitChain) {
      const chainsToQuery = includeTestnets
        ? getAllChainsWithOverrides()
        : getDefaultReadOnlyChains();
      const chainNames = chainsToQuery.map((chain) => chain.name);
      if (!includeTestnets) {
        const representativeChain = chainsToQuery[0];
        const response = await fetchGlobalEvents(
          representativeChain,
          page,
          perPage,
        );
        spin.stop();

        const eventsRaw = Array.isArray(response.events) ? response.events : [];
        const events = eventsRaw.map((event) => normalizeActivityEvent(event));
        const responsePerPage = parseNumberishValue(response.perPage) ?? perPage;
        const total = parseNumberishValue(response.total) ?? null;
        const totalPages = deriveKnownTotalPages(
          total,
          responsePerPage,
          parseNumberishValue(response.totalPages) ?? null,
        );

        renderActivity(ctx, {
          mode: "global-activity",
          chain: MULTI_CHAIN_SCOPE_ALL_MAINNETS,
          chains: chainNames,
          page: normalizeAspPage(parseNumberishValue(response.page), page),
          perPage: responsePerPage,
          total,
          totalPages,
          events,
        });
        return;
      }

      const representativeChains = [...new Map(
        chainsToQuery.map((chainConfig) => [chainConfig.aspHost, chainConfig] as const),
      ).values()];
      const fetchWindow = Math.max(page * perPage, perPage);
      const responses = await Promise.all(
        representativeChains.map((chainConfig) =>
          fetchGlobalEvents(chainConfig, 1, fetchWindow),
        ),
      );
      spin.stop();

      const events = responses
        .flatMap((response) => Array.isArray(response.events) ? response.events : [])
        .map((event) => normalizeActivityEvent(event))
        .sort((left, right) => {
          const leftTs = left.timestampMs ?? 0;
          const rightTs = right.timestampMs ?? 0;
          return rightTs - leftTs;
        })
        .slice((page - 1) * perPage, page * perPage);

      renderActivity(ctx, {
        mode: "global-activity",
        chain: MULTI_CHAIN_SCOPE_ALL_CHAINS,
        chains: chainNames,
        page,
        perPage,
        total: null,
        totalPages: null,
        events,
        note: "Pagination totals are unavailable when aggregating mainnet and testnet activity together. Results may be sparse.",
      });
      return;
    }

    // Single-chain global activity keeps ASP pagination metadata.
    const chainConfig = resolveChain(explicitChain, config.defaultChain);
    const response = await fetchGlobalEvents(chainConfig, page, perPage);
    spin.stop();

    const eventsRaw = Array.isArray(response.events) ? response.events : [];
    const events = eventsRaw.map((event) => normalizeActivityEvent(event));
    const responsePerPage = parseNumberishValue(response.perPage) ?? perPage;
    const total = parseNumberishValue(response.total) ?? null;
    const totalPages = deriveKnownTotalPages(
      total,
      responsePerPage,
      parseNumberishValue(response.totalPages) ?? null,
    );

    renderActivity(ctx, {
      mode: "global-activity",
      chain: chainConfig.name,
      page: normalizeAspPage(parseNumberishValue(response.page), page),
      perPage: responsePerPage,
      total,
      totalPages,
      events,
    });
  } catch (error) {
    printError(error, isJson);
  }
}

export async function handlePoolsStatsCommand(
  positionalAsset: string | undefined,
  _opts: PoolsStatsCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(cmd);
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const silent = isJson || mode.isQuiet || mode.isWide;

  try {
    if (positionalAsset) {
      const config = loadConfig();
      const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
      const pool = await resolvePool(
        chainConfig,
        positionalAsset,
        globalOpts?.rpcUrl,
      );

      if (
        await maybeRenderPreviewProgressStep("stats.pool.fetch", {
          spinnerText: "Fetching pool statistics...",
          doneText: "Pool statistics loaded.",
        })
      ) {
        return;
      }
      const spin = spinner("Fetching pool statistics...", silent);
      spin.start();
      const stats: PoolStatisticsResponse = await fetchPoolStatistics(
        chainConfig,
        pool.scope,
      );
      spin.stop();

      const ctx = createOutputContext(mode);
      renderPoolStats(ctx, {
        chain: chainConfig.name,
        asset: pool.symbol,
        pool: pool.pool,
        scope: pool.scope.toString(),
        cacheTimestamp: stats.cacheTimestamp ?? null,
        allTime: stats.pool?.allTime ?? null,
        last24h: stats.pool?.last24h ?? null,
      });
      return;
    }

    const explicitChain = globalOpts?.chain;
    if (explicitChain) {
      throw inputError(
        "INPUT_FLAG_CONFLICT",
        "Global pool statistics are aggregated across all chains. The --chain flag is not supported without an asset.",
        "For chain-specific data use: privacy-pools pools stats <symbol> --chain <chain>",
      );
    }

    const chainsToQuery = getDefaultReadOnlyChains();
    const chainNames = chainsToQuery.map((chain) => chain.name);
    const representativeChain = chainsToQuery[0];
    if (
      await maybeRenderPreviewProgressStep("stats.global.fetch", {
        spinnerText: "Fetching global statistics...",
        doneText: "Global statistics loaded.",
      })
    ) {
      return;
    }
    const spin = spinner("Fetching global statistics...", silent);
    spin.start();

    const stats: GlobalStatisticsResponse =
      await fetchGlobalStatistics(representativeChain);
    spin.stop();

    const ctx = createOutputContext(mode);
    renderGlobalStats(ctx, {
      chain: MULTI_CHAIN_SCOPE_ALL_MAINNETS,
      chains: chainNames,
      cacheTimestamp: stats.cacheTimestamp ?? null,
      allTime: stats.allTime ?? null,
      last24h: stats.last24h ?? null,
    });
  } catch (error) {
    printError(error, isJson);
  }
}
