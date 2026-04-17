import type { Command } from "commander";
import type { Address } from "viem";
import {
  getDefaultReadOnlyChains,
  getAllChainsWithOverrides,
} from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { listPools, resolvePool } from "../services/pools.js";
import { loadMnemonic } from "../services/wallet.js";
import { loadAccount } from "../services/account-storage.js";
import { getDataService } from "../services/sdk.js";
import {
  initializeAccountService,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import {
  fetchPoolEvents,
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
import {
  buildPoolAccountRefs,
  collectActiveLabels,
} from "../utils/pool-accounts.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
import type {
  ChainConfig,
  GlobalOptions,
  PoolStats,
  AspPublicEvent,
} from "../types.js";
import { warnLegacyAllChainsFlag } from "../utils/deprecations.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { normalizeActivityEvent } from "../utils/public-activity.js";
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
import type {
  PoolDetailActivityEvent,
  PoolWithChain,
  PoolsRenderData,
} from "../output/pools.js";

interface PoolsCommandOptions {
  includeTestnets?: boolean;
  allChains?: boolean;
  search?: string;
  sort?: string;
}

interface ChainPoolsResult {
  chainConfig: ChainConfig;
  pools: PoolStats[];
  error?: unknown;
}

export { createPoolsCommand } from "../command-shells/pools.js";

function parseSortMode(raw: string | undefined): PoolsSortMode {
  const normalized = raw?.trim().toLowerCase() ?? "default";
  if ((SUPPORTED_SORT_MODES as readonly string[]).includes(normalized)) {
    return normalized as PoolsSortMode;
  }
  throw new CLIError(
    `Invalid --sort value: ${raw}.`,
    "INPUT",
    `Use one of: ${SUPPORTED_SORT_MODES.join(", ")}.`,
  );
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

export async function handlePoolsCommand(
  asset: string | undefined,
  opts: PoolsCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);
  const silent = isSilent(ctx);
  const isVerbose = globalOpts?.verbose ?? false;

  if (await maybeRenderPreviewScenario("pools")) {
    return;
  }

  // ── Detail view: `pools <asset>` ──────────────────────────────────
  if (asset) {
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
            timeLabel: normalized.timeLabel,
            status: normalized.reviewStatus,
          };
        });
      } catch {
        recentActivityUnavailable = true;
      }

      spin.stop();

      renderPoolDetail(ctx, {
        chain: chainConfig.name,
        pool,
        tokenPrice,
        walletState,
        myPoolAccounts,
        myFundsWarning,
        recentActivity,
        recentActivityUnavailable,
      });
    } catch (error) {
      printError(error, mode.isJson);
    }
    return;
  }

  // ── Listing view ──────────────────────────────────────────────────
  try {
    if (opts.allChains && !opts.includeTestnets) {
      warnLegacyAllChainsFlag(silent);
    }
    const explicitChain = globalOpts?.chain;
    const includeTestnets = opts.includeTestnets || opts.allChains;
    const isMultiChain = includeTestnets || !explicitChain;

    if (isMultiChain && globalOpts?.rpcUrl) {
      throw new CLIError(
        "--rpc-url cannot be combined with multi-chain queries.",
        "INPUT",
        "Use --chain <name> to target a single chain with --rpc-url.",
      );
    }

    const config = loadConfig();
    const sortMode = parseSortMode(opts.sort);
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
      search: searchQuery ?? null,
      sort: sortMode,
      filteredPools: [],
      warnings,
    };

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

    renderData.filteredPools = sortPools(
      applySearch(rawPools, searchQuery),
      sortMode,
    );

    if (isMultiChain) {
      renderData.chainSummaries = chainResults.map((result) => ({
        chain: result.chainConfig.name,
        pools: result.pools.length,
        error: result.error ? classifyError(result.error).message : null,
      }));
    }

    renderPools(ctx, renderData);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
