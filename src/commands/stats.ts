import type { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { resolvePool } from "../services/pools.js";
import { fetchGlobalStatistics, fetchPoolStatistics } from "../services/asp.js";
import { CLIError, printError } from "../utils/errors.js";
import { spinner } from "../utils/format.js";
import type {
  GlobalOptions,
  PoolStatisticsResponse,
  GlobalStatisticsResponse,
} from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderGlobalStats, renderPoolStats } from "../output/stats.js";
import { maybeRenderPreviewProgressStep } from "../preview/runtime.js";
import {
  getDefaultReadOnlyChains,
  MULTI_CHAIN_SCOPE_ALL_MAINNETS,
} from "../config/chains.js";

interface PoolStatsCommandOptions {
  asset?: string;
}

/** @internal Exported for unit testing. */
export { parseUsd, parseCount } from "../output/stats.js";
export { createStatsCommand } from "../command-shells/stats.js";

export async function handleGlobalStatsCommand(
  _opts: unknown,
  subCmd: Command,
): Promise<void> {
  const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;

  try {
    const explicitChain = globalOpts?.chain;
    const silent = isJson || mode.isQuiet;

    // Global statistics are aggregated across all chains by the ASP.
    // The --chain flag is not meaningful here; reject it early.
    if (explicitChain) {
      throw new CLIError(
        "Global statistics are aggregated across all chains. The --chain flag is not supported for this subcommand.",
        "INPUT",
        "For chain-specific data use: privacy-pools stats pool --asset <symbol> --chain <chain>",
      );
    }

    // Global stats: the ASP global endpoint returns cross-chain data,
    // so we call it exactly once using a representative chain config.
    const chainsToQuery = getDefaultReadOnlyChains();
    const chainNames = chainsToQuery.map((c) => c.name);
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
      mode: "global-stats",
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

export async function handlePoolStatsCommand(
  opts: PoolStatsCommandOptions,
  subCmd: Command,
): Promise<void> {
  const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;

  try {
    if (!opts.asset) {
      throw new CLIError(
        "Missing required --asset <symbol|address>.",
        "INPUT",
        "Example: privacy-pools stats pool --asset ETH",
      );
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    const pool = await resolvePool(chainConfig, opts.asset, globalOpts?.rpcUrl);
    const silent = isJson || mode.isQuiet;

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
      mode: "pool-stats",
      chain: chainConfig.name,
      asset: pool.symbol,
      pool: pool.pool,
      scope: pool.scope.toString(),
      cacheTimestamp: stats.cacheTimestamp ?? null,
      allTime: stats.pool?.allTime ?? null,
      last24h: stats.pool?.last24h ?? null,
    });
  } catch (error) {
    printError(error, isJson);
  }
}
