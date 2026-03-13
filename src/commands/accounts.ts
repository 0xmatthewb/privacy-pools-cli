import { Command } from "commander";
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
  initializeAccountService,
  syncAccountEvents,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { listPools } from "../services/pools.js";
import { fetchApprovedLabels, fetchDepositReviewStatuses } from "../services/asp.js";
import { spinner, verbose, deriveTokenPrice } from "../utils/format.js";
import { withSpinnerProgress } from "../utils/proof-progress.js";
import { CLIError, classifyError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import type { ChainConfig, GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { buildAllPoolAccountRefs } from "../utils/pool-accounts.js";
import { normalizeAspApprovalStatus, type AspApprovalStatus } from "../utils/statuses.js";
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
}

function describeAccountsChainScope(allChains: boolean | undefined): string {
  return allChains ? "all chains" : "mainnet chains";
}

function formatAccountsLoadingText(
  allChains: boolean | undefined,
  completedChains?: number,
  totalChains?: number,
): string {
  const baseText = `Loading My Pools across ${describeAccountsChainScope(allChains)}...`;
  if (completedChains === undefined || totalChains === undefined) return baseText;
  return `${baseText} (${completedChains}/${totalChains} complete)`;
}

function collectSpendableLabels(
  commitments: ReadonlyArray<unknown>,
): string[] {
  const labels = new Set<string>();

  for (const commitment of commitments) {
    if (typeof commitment !== "object" || commitment === null) continue;
    const label = "label" in commitment ? (commitment as { label?: unknown }).label : undefined;
    if (typeof label !== "bigint") continue;
    labels.add(label.toString());
  }

  return Array.from(labels);
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

async function loadAccountsForChain(
  chainConfig: ChainConfig,
  ctx: ChainLoadContext,
): Promise<LoadedChainAccounts> {
  const { opts, rpcUrl, spin, showPerChainProgress, silent, mode, isVerbose, mnemonic } = ctx;
  verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

  if (spin && showPerChainProgress) {
    spin.text = `Discovering pools on ${chainConfig.name}...`;
  }
  const pools = await listPools(chainConfig, rpcUrl);
  verbose(`Discovered ${pools.length} pool(s) on ${chainConfig.name}`, isVerbose, silent);

  if (pools.length === 0) {
    return { chainConfig, groups: [] };
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
  const dataService = await getDataService(
    chainConfig,
    pools[0].pool,
    rpcUrl,
  );
  const accountService = await initializeAccountService(
    dataService,
    mnemonic,
    poolInfos,
    chainConfig.id,
    false,
    silent,
    true,
  );

  const syncChain = () => syncAccountEvents(accountService, poolInfos, pools, chainConfig.id, {
    skip: opts.sync === false,
    force: false,
    silent,
    isJson: mode.isJson,
    isVerbose,
    errorLabel: "Account",
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
  // Always include historical scopes so spent/exited-only users still see
  // their pool accounts instead of a confusing empty state.
  const sortedScopeStrings = collectAccountScopeStrings(
    spendable,
    accountService.account,
    true,
  );

  if (spin && showPerChainProgress) {
    spin.text = `Checking ASP approval status on ${chainConfig.name}...`;
  }
  const approvedLabelsByScope = new Map<string, Set<string> | null>();
  const reviewStatusesByScope = new Map<string, Map<string, AspApprovalStatus> | null>();
  await Promise.all(
    sortedScopeStrings.map(async (scopeStr) => {
      const pool = poolByScope.get(scopeStr);
      if (pool) {
        const labels = collectSpendableLabels(spendable.get(BigInt(scopeStr)) ?? []);
        const [approvedLabels, rawReviewStatuses] = await Promise.all([
          fetchApprovedLabels(chainConfig, pool.scope),
          fetchDepositReviewStatuses(chainConfig, pool.scope, labels),
        ]);

        approvedLabelsByScope.set(scopeStr, approvedLabels);
        reviewStatusesByScope.set(
          scopeStr,
          rawReviewStatuses
            ? new Map(
                Array.from(rawReviewStatuses.entries()).map(([label, status]) => [
                  label,
                  normalizeAspApprovalStatus(status),
                ]),
              )
            : null,
        );
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
    // Always show all pool accounts (pending, approved, spent, exited).
    // Users commonly check accounts to see if a pending deposit has been
    // approved — hiding any state behind --all creates a confusing empty view.
    const poolAccounts = buildAllPoolAccountRefs(
      accountService.account,
      pool.scope,
      commitments,
      approvedLabels,
      reviewStatuses,
    );
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

  return { chainConfig, groups };
}

// ── Command ─────────────────────────────────────────────────────────────────

export function createAccountsCommand(): Command {
  const metadata = getCommandMetadata("accounts");
  return new Command("accounts")
    .description(metadata.description)
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option("--all-chains", "Include testnet chains (mainnet chains shown by default)")
    .option("--details", "Show additional details per Pool Account")
    .option("--summary", "Show counts and balances only")
    .option("--pending-only", "Show only pending ASP approvals")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (opts: AccountsCommandOptions, cmd) => {
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
        const queriedChains = useMultiChain ? chainsToQuery.map((chain) => chain.name) : undefined;
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
            spin.text = formatAccountsLoadingText(opts.allChains, completedChains, totalChains);
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

            loadedResults.push(outcome.result);
          }
        } else {
          for (const chainConfig of chainsToQuery) {
            try {
              const result = await loadAccountsForChain(chainConfig, chainCtx);
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
    });
}
