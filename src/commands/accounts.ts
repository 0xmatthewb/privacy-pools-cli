import type { Command } from "commander";
import type { Address } from "viem";
import {
  getAllChainsWithOverrides,
  getDefaultReadOnlyChains,
  MULTI_CHAIN_SCOPE_ALL_MAINNETS,
  MULTI_CHAIN_SCOPE_ALL_CHAINS,
} from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import {
  getStoredLegacyPoolAccounts,
  initializeAccountServiceWithState,
  syncAccountEvents,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { listPools } from "../services/pools.js";
import {
  formatIncompleteAspReviewDataMessage,
  hasIncompleteDepositReviewData,
  loadAspDepositReviewState,
  type LoadedAspDepositReviewState,
} from "../services/asp.js";
import { spinner, verbose, deriveTokenPrice } from "../utils/format.js";
import { withSpinnerProgress } from "../utils/proof-progress.js";
import { CLIError, classifyError, printError } from "../utils/errors.js";
import type { ChainConfig, GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  buildAllPoolAccountRefs,
  buildDeclinedLegacyPoolAccountRefs,
  collectActiveLabels,
} from "../utils/pool-accounts.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderAccountsNoPools, renderAccounts } from "../output/accounts.js";
import type { AccountPoolGroup, AccountWarning } from "../output/accounts.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface AccountsCommandOptions {
  sync?: boolean;
  allChains?: boolean;
  details?: boolean;
  summary?: boolean;
  pendingOnly?: boolean;
}

interface AccountScopeSource {
  poolAccounts?: Map<bigint, unknown[]>;
}

interface LoadedChainAccounts {
  chainConfig: ChainConfig;
  groups: AccountPoolGroup[];
  warnings: AccountWarning[];
}

export { createAccountsCommand } from "../command-shells/accounts.js";

export function describeAccountsChainScope(
  allChains: boolean | undefined,
): string {
  return allChains ? "all chains" : "mainnet chains";
}

export function formatAccountsLoadingText(
  allChains: boolean | undefined,
  completedChains?: number,
  totalChains?: number,
): string {
  const baseText = `Loading My Pools across ${describeAccountsChainScope(allChains)}...`;
  if (completedChains === undefined || totalChains === undefined)
    return baseText;
  return `${baseText} (${completedChains}/${totalChains} complete)`;
}

/** Bundled context for loadAccountsForChain — avoids 8-param sprawl. */
interface ChainLoadContext {
  opts: AccountsCommandOptions;
  rpcUrl: string | undefined;
  spin?: ReturnType<typeof spinner>;
  showPerChainProgress: boolean;
  silent: boolean;
  mode: ReturnType<typeof resolveGlobalMode>;
  isVerbose: boolean;
  mnemonic: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function collectAccountScopeStrings(
  spendable: ReadonlyMap<bigint, readonly unknown[]>,
  account: AccountScopeSource | null | undefined,
  includeHistorical: boolean,
): string[] {
  const scopeSet = new Set<string>();
  for (const scope of spendable.keys()) {
    scopeSet.add(scope.toString());
  }

  if (includeHistorical) {
    const map = account?.poolAccounts;
    if (map instanceof Map) {
      for (const scope of map.keys()) {
        scopeSet.add(scope.toString());
      }
    }
  }

  return Array.from(scopeSet).sort((a, b) => {
    const aa = BigInt(a);
    const bb = BigInt(b);
    if (aa < bb) return -1;
    if (aa > bb) return 1;
    return 0;
  });
}

export function hasIncompleteAspReviewData(
  labels: readonly string[],
  approvedLabels: Set<string> | null,
  reviewStatuses: ReadonlyMap<string, unknown> | null,
): boolean {
  return hasIncompleteDepositReviewData(labels, approvedLabels, reviewStatuses);
}

async function loadAccountsForChain(
  chainConfig: ChainConfig,
  ctx: ChainLoadContext,
): Promise<LoadedChainAccounts> {
  const {
    opts,
    rpcUrl,
    spin,
    showPerChainProgress,
    silent,
    mode,
    isVerbose,
    mnemonic,
  } = ctx;
  verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

  if (spin && showPerChainProgress) {
    spin.text = `Discovering pools on ${chainConfig.name}...`;
  }
  const pools = await listPools(chainConfig, rpcUrl);
  verbose(
    `Discovered ${pools.length} pool(s) on ${chainConfig.name}`,
    isVerbose,
    silent,
  );

  if (pools.length === 0) {
    return { chainConfig, groups: [], warnings: [] };
  }

  // Pre-build scope→pool lookup to avoid repeated linear scans.
  const poolByScope = new Map<string, (typeof pools)[number]>();
  for (const p of pools) {
    poolByScope.set(p.scope.toString(), p);
  }

  const poolInfos = pools.map((p) => ({
    chainId: chainConfig.id,
    address: p.pool as Address,
    scope: p.scope,
    deploymentBlock: p.deploymentBlock ?? chainConfig.startBlock,
  }));

  if (spin && showPerChainProgress) {
    spin.text = `Initializing account state on ${chainConfig.name}...`;
  }
  const dataService = await getDataService(chainConfig, pools[0].pool, rpcUrl);
  const {
    accountService,
    skipImmediateSync,
    legacyDeclinedLabels,
  } =
    await initializeAccountServiceWithState(
      dataService,
      mnemonic,
      poolInfos,
      chainConfig.id,
      {
        allowLegacyAccountRebuild: opts.sync !== false,
        allowLegacyRecoveryVisibility: true,
        suppressWarnings: silent,
        strictSync: true,
      },
    );

  const syncChain = () =>
    syncAccountEvents(accountService, poolInfos, pools, chainConfig.id, {
      skip: opts.sync === false || skipImmediateSync,
      force: false,
      silent,
      isJson: mode.isJson,
      isVerbose,
      errorLabel: "Account",
      dataService,
      mnemonic,
      allowLegacyRecoveryVisibility: true,
    });
  if (spin && showPerChainProgress) {
    await withSpinnerProgress(
      spin,
      `Syncing onchain events on ${chainConfig.name}`,
      syncChain,
    );
  } else {
    await syncChain();
  }

  const spendable = withSuppressedSdkStdoutSync(() =>
    accountService.getSpendableCommitments(),
  );
  const legacyPoolAccounts = getStoredLegacyPoolAccounts(accountService.account);
  // Always include historical scopes so spent/exited-only users still see
  // their pool accounts instead of a confusing empty state.
  const scopeSet = new Set(
    collectAccountScopeStrings(
      spendable,
      accountService.account,
      true,
    ),
  );
  if (
    legacyPoolAccounts instanceof Map
    && legacyDeclinedLabels
    && legacyDeclinedLabels.size > 0
  ) {
    for (const scope of legacyPoolAccounts.keys()) {
      scopeSet.add(scope.toString());
    }
  }
  const sortedScopeStrings = [...scopeSet].sort((a, b) => {
    const aa = BigInt(a);
    const bb = BigInt(b);
    if (aa < bb) return -1;
    if (aa > bb) return 1;
    return 0;
  });

  if (spin && showPerChainProgress) {
    spin.text = `Checking ASP approval status on ${chainConfig.name}...`;
  }
  const approvedLabelsByScope = new Map<string, Set<string> | null>();
  const reviewStatusesByScope = new Map<
    string,
    LoadedAspDepositReviewState["reviewStatuses"]
  >();
  let hasPartialAspReviewData = false;
  await Promise.all(
    sortedScopeStrings.map(async (scopeStr) => {
      const pool = poolByScope.get(scopeStr);
      if (pool) {
        const labels = collectActiveLabels(
          spendable.get(BigInt(scopeStr)) ?? [],
        );
        const aspReviewState = await loadAspDepositReviewState(
          chainConfig,
          pool.scope,
          labels,
        );

        approvedLabelsByScope.set(scopeStr, aspReviewState.approvedLabels);
        reviewStatusesByScope.set(scopeStr, aspReviewState.reviewStatuses);
        if (aspReviewState.hasIncompleteReviewData) {
          hasPartialAspReviewData = true;
        }
      }
    }),
  );

  const groups: AccountPoolGroup[] = [];
  for (const scopeStr of sortedScopeStrings) {
    const scopeBigInt = BigInt(scopeStr);
    const commitments = spendable.get(scopeBigInt) ?? [];
    const pool = poolByScope.get(scopeStr);
    if (!pool) continue;

    const approvedLabels = approvedLabelsByScope.get(scopeStr);
    const reviewStatuses = reviewStatusesByScope.get(scopeStr);
    const allKnownSafePoolAccounts = buildAllPoolAccountRefs(
      accountService.account,
      pool.scope,
      commitments,
      approvedLabels,
      reviewStatuses,
    );
    const knownLabels = new Set(
      allKnownSafePoolAccounts.map((poolAccount) => poolAccount.label.toString()),
    );
    const declinedLegacyPoolAccounts = buildDeclinedLegacyPoolAccountRefs(
      legacyPoolAccounts ? { poolAccounts: legacyPoolAccounts } : null,
      pool.scope,
      legacyDeclinedLabels ?? new Set<string>(),
      allKnownSafePoolAccounts.length + 1,
    ).filter((poolAccount) => !knownLabels.has(poolAccount.label.toString()));
    // Always show all pool accounts (pending, approved, spent, exited).
    // Users commonly check accounts to see if a pending deposit has been
    // approved — hiding any state behind --all creates a confusing empty view.
    const poolAccounts = [
      ...allKnownSafePoolAccounts,
      ...declinedLegacyPoolAccounts,
    ];
    poolAccounts.sort((a, b) => a.paNumber - b.paNumber);

    groups.push({
      chain: chainConfig.name,
      chainId: chainConfig.id,
      symbol: pool.symbol,
      poolAddress: pool.pool,
      decimals: pool.decimals,
      scope: pool.scope,
      tokenPrice: deriveTokenPrice(pool),
      poolAccounts,
    });
  }

  const warnings: AccountWarning[] = hasPartialAspReviewData
    ? [
        {
          chain: chainConfig.name,
          category: "ASP",
          message: formatIncompleteAspReviewDataMessage("accounts"),
        },
      ]
    : [];

  return { chainConfig, groups, warnings };
}

// ── Command ─────────────────────────────────────────────────────────────────

export async function handleAccountsCommand(
  opts: AccountsCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const outCtx = createOutputContext(mode, isVerbose);
  const silent = isSilent(outCtx);

  try {
    if (opts.summary && opts.pendingOnly) {
      throw new CLIError(
        "Cannot specify both --summary and --pending-only.",
        "INPUT",
        "Use one compact polling mode at a time.",
      );
    }

    if ((opts.summary || opts.pendingOnly) && opts.details) {
      throw new CLIError(
        "Compact account modes do not support --details.",
        "INPUT",
        "Remove --details when using --summary or --pending-only.",
      );
    }

    const config = loadConfig();
    const explicitChain = globalOpts?.chain;
    const useMultiChain = opts.allChains || !explicitChain;

    if (useMultiChain && globalOpts?.rpcUrl) {
      throw new CLIError(
        "--rpc-url cannot be combined with multi-chain accounts queries.",
        "INPUT",
        "Use --chain <name> to target a single chain with --rpc-url.",
      );
    }

    const chainsToQuery = opts.allChains
      ? getAllChainsWithOverrides()
      : explicitChain
        ? [resolveChain(explicitChain, config.defaultChain)]
        : getDefaultReadOnlyChains();

    const rootChain = explicitChain
      ? chainsToQuery[0].name
      : opts.allChains
        ? MULTI_CHAIN_SCOPE_ALL_CHAINS
        : MULTI_CHAIN_SCOPE_ALL_MAINNETS;
    const queriedChains = useMultiChain
      ? chainsToQuery.map((chain) => chain.name)
      : undefined;
    const mnemonic = loadMnemonic();

    const spin = spinner(
      useMultiChain
        ? formatAccountsLoadingText(opts.allChains)
        : `Loading Pool Accounts on ${chainsToQuery[0].name}...`,
      silent,
    );
    spin.start();
    const useParallelChainLoading = useMultiChain && chainsToQuery.length > 1;

    const chainCtx: ChainLoadContext = {
      opts,
      rpcUrl: globalOpts?.rpcUrl,
      spin,
      showPerChainProgress: !useParallelChainLoading,
      silent,
      mode,
      isVerbose,
      mnemonic,
    };

    const loadedResults: LoadedChainAccounts[] = [];
    const warnings: AccountWarning[] = [];
    let firstError: unknown;

    if (useParallelChainLoading) {
      const totalChains = chainsToQuery.length;
      let completedChains = 0;
      let showAggregateProgress = false;
      const updateAggregateProgress = () => {
        if (!showAggregateProgress || silent) return;
        spin.text = formatAccountsLoadingText(
          opts.allChains,
          completedChains,
          totalChains,
        );
      };
      const progressTimer = setTimeout(() => {
        showAggregateProgress = true;
        updateAggregateProgress();
      }, 3000);

      type ChainLoadOutcome =
        | { chainConfig: ChainConfig; result: LoadedChainAccounts }
        | { chainConfig: ChainConfig; error: unknown };

      // Preserve deterministic output order by iterating the Promise.all results
      // in the same order as the input chain list, even though the work runs concurrently.
      let outcomes: ChainLoadOutcome[] = [];
      try {
        outcomes = await Promise.all(
          chainsToQuery.map(async (chainConfig) => {
            try {
              const result = await loadAccountsForChain(chainConfig, chainCtx);
              return { chainConfig, result };
            } catch (error) {
              return { chainConfig, error };
            } finally {
              completedChains += 1;
              updateAggregateProgress();
            }
          }),
        );
      } finally {
        clearTimeout(progressTimer);
      }

      for (const outcome of outcomes) {
        if ("error" in outcome) {
          if (firstError === undefined) firstError = outcome.error;
          const classified = classifyError(outcome.error);
          warnings.push({
            chain: outcome.chainConfig.name,
            category: classified.category,
            message: classified.message,
          });
          continue;
        }

        warnings.push(...outcome.result.warnings);
        loadedResults.push(outcome.result);
      }
    } else {
      for (const chainConfig of chainsToQuery) {
        try {
          const result = await loadAccountsForChain(chainConfig, chainCtx);
          warnings.push(...result.warnings);
          loadedResults.push(result);
        } catch (error) {
          if (firstError === undefined) firstError = error;
          const classified = classifyError(error);
          warnings.push({
            chain: chainConfig.name,
            category: classified.category,
            message: classified.message,
          });
        }
      }
    }

    spin.stop();

    if (loadedResults.length === 0) {
      throw firstError;
    }

    const groups = loadedResults.flatMap((result) => result.groups);
    if (groups.length === 0) {
      renderAccountsNoPools(outCtx, {
        chain: rootChain,
        allChains: opts.allChains || undefined,
        chains: queriedChains,
        warnings,
        summary: !!opts.summary,
        pendingOnly: !!opts.pendingOnly,
      });
      return;
    }

    renderAccounts(outCtx, {
      chain: rootChain,
      allChains: opts.allChains || undefined,
      chains: queriedChains,
      warnings,
      groups,
      showDetails: !!opts.details,
      showSummary: !!opts.summary,
      showPendingOnly: !!opts.pendingOnly,
    });
  } catch (error) {
    printError(error, mode.isJson);
  }
}
