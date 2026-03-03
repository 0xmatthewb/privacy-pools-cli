import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { resolvePool } from "../services/pools.js";
import { fetchGlobalStatistics, fetchPoolStatistics } from "../services/asp.js";
import { CLIError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { spinner } from "../utils/format.js";
import type {
  GlobalOptions,
  PoolStatisticsResponse,
  GlobalStatisticsResponse,
} from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderGlobalStats, renderPoolStats } from "../output/stats.js";
import { getDefaultReadOnlyChains } from "../config/chains.js";

interface PoolStatsCommandOptions {
  asset?: string;
}

/** @internal Exported for unit testing. */
export { parseUsd, parseCount } from "../output/stats.js";

export function createStatsCommand(): Command {
  const command = new Command("stats")
    .description("Show public statistics")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools stats global\n  privacy-pools stats pool --asset ETH\n  privacy-pools stats pool --asset USDC --json --chain mainnet\n"
    );

  command
    .command("global", { isDefault: true })
    .description("Show global Privacy Pools statistics (all-time and last 24h)")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools stats global\n  privacy-pools stats global --json --chain mainnet\n"
        + commandHelpText({
          jsonFields: "{ mode, chain, cacheTimestamp?, allTime?, last24h? }",
        })
    )
    .action(async (_opts, subCmd) => {
      const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;

      try {
        const config = loadConfig();
        const explicitChain = globalOpts?.chain;
        const silent = isJson || mode.isQuiet;

        if (!explicitChain) {
          // Global stats: the ASP global endpoint returns cross-chain data,
          // so we call it exactly once using a representative chain config.
          const chainsToQuery = getDefaultReadOnlyChains();
          const chainNames = chainsToQuery.map((c) => c.name);
          const representativeChain = chainsToQuery[0];
          const spin = spinner("Fetching global statistics...", silent);
          spin.start();

          const stats: GlobalStatisticsResponse = await fetchGlobalStatistics(representativeChain);
          spin.stop();

          const ctx = createOutputContext(mode);
          renderGlobalStats(ctx, {
            mode: "global-stats",
            chain: "all-mainnets",
            chains: chainNames,
            cacheTimestamp: stats.cacheTimestamp ?? null,
            allTime: stats.allTime ?? null,
            last24h: stats.last24h ?? null,
          });
          return;
        }

        // Single chain: explicit --chain flag
        const chainConfig = resolveChain(explicitChain, config.defaultChain);
        const spin = spinner("Fetching global statistics...", silent);
        spin.start();
        const stats: GlobalStatisticsResponse = await fetchGlobalStatistics(chainConfig);
        spin.stop();

        const ctx = createOutputContext(mode);
        renderGlobalStats(ctx, {
          mode: "global-stats",
          chain: chainConfig.name,
          cacheTimestamp: stats.cacheTimestamp ?? null,
          allTime: stats.allTime ?? null,
          last24h: stats.last24h ?? null,
        });
      } catch (error) {
        printError(error, isJson);
      }
    });

  command
    .command("pool")
    .description("Show statistics for a specific pool (all-time and last 24h)")
    .option("-a, --asset <symbol|address>", "Pool asset (symbol like ETH, USDC, or token address)")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools stats pool --asset ETH\n  privacy-pools stats pool --asset USDC --json --chain mainnet\n"
        + commandHelpText({
          jsonFields: "{ mode, chain, asset, pool, scope, cacheTimestamp?, allTime?, last24h? }",
        })
    )
    .action(async (opts: PoolStatsCommandOptions, subCmd) => {
      const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;

      try {
        if (!opts.asset) {
          throw new CLIError(
            "Missing required --asset <symbol|address>.",
            "INPUT",
            "Example: privacy-pools stats pool --asset ETH"
          );
        }

        const config = loadConfig();
        const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
        const pool = await resolvePool(chainConfig, opts.asset, globalOpts?.rpcUrl);
        const silent = isJson || mode.isQuiet;

        const spin = spinner("Fetching pool statistics...", silent);
        spin.start();
        const stats: PoolStatisticsResponse = await fetchPoolStatistics(chainConfig, pool.scope);
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
    });

  return command;
}
