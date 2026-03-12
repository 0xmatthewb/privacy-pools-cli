import { Command } from "commander";
import type { Address } from "viem";
import { getDefaultReadOnlyChains, getAllChainsWithOverrides } from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { loadConfig, configExists, mnemonicExists } from "../services/config.js";
import { listPools, resolvePool } from "../services/pools.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import {
  initializeAccountService,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { fetchPoolEvents } from "../services/asp.js";
import {
  spinner,
  formatAmount,
  formatTimeAgo,
  displayDecimals,
  deriveTokenPrice,
} from "../utils/format.js";
import { CLIError, classifyError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { buildPoolAccountRefs } from "../utils/pool-accounts.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
import type { ChainConfig, GlobalOptions, PoolStats, AspPublicEvent } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderPoolsEmpty, renderPools, renderPoolDetail } from "../output/pools.js";
import type { PoolWithChain, PoolsRenderData } from "../output/pools.js";

interface PoolsCommandOptions {
  allChains?: boolean;
  search?: string;
  sort?: string;
}

interface ChainPoolsResult {
  chainConfig: ChainConfig;
  pools: PoolStats[];
  error?: unknown;
}

const SUPPORTED_SORT_MODES = [
  "default",
  "asset-asc",
  "asset-desc",
  "tvl-desc",
  "tvl-asc",
  "deposits-desc",
  "deposits-asc",
  "chain-asset",
] as const;

type PoolsSortMode = (typeof SUPPORTED_SORT_MODES)[number];

function parseSortMode(raw: string | undefined): PoolsSortMode {
  const normalized = raw?.trim().toLowerCase() ?? "default";
  if ((SUPPORTED_SORT_MODES as readonly string[]).includes(normalized)) {
    return normalized as PoolsSortMode;
  }
  throw new CLIError(
    `Invalid --sort value: ${raw}.`,
    "INPUT",
    `Use one of: ${SUPPORTED_SORT_MODES.join(", ")}.`
  );
}

function poolFundsMetric(pool: PoolStats): bigint {
  return pool.totalInPoolValue ?? pool.acceptedDepositsValue ?? 0n;
}

function poolDepositsMetric(pool: PoolStats): number {
  return pool.totalDepositsCount ?? 0;
}

function withChainMeta(chainConfig: ChainConfig, pools: PoolStats[]): PoolWithChain[] {
  return pools.map((pool) => ({
    chain: chainConfig.name,
    chainId: chainConfig.id,
    pool,
  }));
}

function applySearch(
  pools: PoolWithChain[],
  query: string | undefined
): PoolWithChain[] {
  const terms = (query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
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
  mode: PoolsSortMode
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
        const l = poolFundsMetric(left.pool);
        const r = poolFundsMetric(right.pool);
        diff = l === r ? 0 : l > r ? -1 : 1;
        break;
      }
      case "tvl-asc": {
        const l = poolFundsMetric(left.pool);
        const r = poolFundsMetric(right.pool);
        diff = l === r ? 0 : l < r ? -1 : 1;
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
        if (diff === 0) diff = left.pool.symbol.localeCompare(right.pool.symbol);
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

export function createPoolsCommand(): Command {
  const metadata = getCommandMetadata("pools");
  return new Command("pools")
    .description(metadata.description)
    .argument("[asset]", "Asset symbol for detail view (e.g. ETH, BOLD)")
    .option("--all-chains", "Include testnet chains (mainnets shown by default)")
    .option("--search <query>", "Filter by chain/symbol/address/scope")
    .option(
      "--sort <mode>",
      `Sort mode (${SUPPORTED_SORT_MODES.join(", ")})`,
      "tvl-desc"
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (asset: string | undefined, opts: PoolsCommandOptions, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const ctx = createOutputContext(mode);
      const silent = isSilent(ctx);

      // ── Detail view: `pools <asset>` ──────────────────────────────────
      if (asset) {
        try {
          const config = loadConfig();
          const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);

          const spin = spinner(`Fetching ${asset} pool details on ${chainConfig.name}...`, silent);
          spin.start();

          const pool = await resolvePool(chainConfig, asset, globalOpts?.rpcUrl);
          const tokenPrice = deriveTokenPrice(pool);

          // Try to load wallet and accounts (non-fatal).
          let myPoolAccounts: PoolAccountRef[] | null = null;
          try {
            const mnemonic = loadMnemonic();
            const dataService = await getDataService(chainConfig, pool.pool, globalOpts?.rpcUrl);
            const accountService = await initializeAccountService(
              dataService,
              mnemonic,
              [{
                chainId: chainConfig.id,
                address: pool.pool as Address,
                scope: pool.scope,
                deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
              }],
              chainConfig.id,
              true,
              true,
              true
            );
            const spendable = withSuppressedSdkStdoutSync(() =>
              accountService.getSpendableCommitments()
            );
            const poolCommitments = spendable.get(pool.scope) ?? [];
            myPoolAccounts = buildPoolAccountRefs(accountService.account, pool.scope, poolCommitments);
          } catch { /* graceful skip — wallet not initialized */ }

          // Try to fetch recent activity (non-fatal).
          interface ActivityEventSummary {
            type: string;
            amount: string | null;
            timeLabel: string;
            status: string | null;
          }
          let recentActivity: ActivityEventSummary[] | null = null;
          try {
            const eventsPage = await fetchPoolEvents(chainConfig, pool.scope, 1, 5);
            const events = Array.isArray(eventsPage.events) ? eventsPage.events : [];
            recentActivity = events.map((e: AspPublicEvent) => {
              const rawAmount = typeof e.amount === "string" ? e.amount
                : typeof e.publicAmount === "string" ? e.publicAmount
                : null;
              let amountFmt = "-";
              if (rawAmount && /^-?\d+$/.test(rawAmount)) {
                try {
                  amountFmt = formatAmount(BigInt(rawAmount), pool.decimals, pool.symbol, displayDecimals(pool.decimals));
                } catch { amountFmt = rawAmount; }
              }
              const ts = typeof e.timestamp === "number"
                ? (e.timestamp < 1e12 ? e.timestamp * 1000 : e.timestamp)
                : null;
              return {
                type: typeof e.type === "string" ? e.type : "unknown",
                amount: amountFmt,
                timeLabel: formatTimeAgo(ts),
                status: typeof e.reviewStatus === "string" ? e.reviewStatus : null,
              };
            });
          } catch { /* graceful skip */ }

          spin.stop();

          renderPoolDetail(ctx, {
            chain: chainConfig.name,
            pool,
            tokenPrice,
            myPoolAccounts,
            recentActivity,
          });
        } catch (error) {
          printError(error, mode.isJson);
        }
        return;
      }

      // ── Listing view ──────────────────────────────────────────────────
      try {
        const explicitChain = globalOpts?.chain;
        const isMultiChain = opts.allChains || !explicitChain;

        if (isMultiChain && globalOpts?.rpcUrl) {
          throw new CLIError(
            "--rpc-url cannot be combined with multi-chain queries.",
            "INPUT",
            "Use --chain <name> to target a single chain with --rpc-url."
          );
        }

        const config = loadConfig();
        const sortMode = parseSortMode(opts.sort);
        const searchQuery = opts.search?.trim();

        let chainsToQuery: ChainConfig[];
        if (opts.allChains) {
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
          silent
        );
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
          })
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

        const rawPools = chainResults.flatMap((result) =>
          withChainMeta(result.chainConfig, result.pools)
        );

        const renderData: PoolsRenderData = {
          allChains: isMultiChain,
          chainName: chainsToQuery[0].name,
          search: searchQuery ?? null,
          sort: sortMode,
          filteredPools: [],
          warnings,
          setupReady: configExists() && mnemonicExists(),
        };

        if (rawPools.length === 0) {
          const firstFailure = chainResults.find((result) => result.error !== undefined);
          if (firstFailure?.error !== undefined) {
            throw firstFailure.error;
          }

          renderPoolsEmpty(ctx, renderData);
          return;
        }

        renderData.filteredPools = sortPools(applySearch(rawPools, searchQuery), sortMode);

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
    });
}
