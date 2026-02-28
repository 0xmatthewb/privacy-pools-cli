import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { resolvePool } from "../services/pools.js";
import { fetchGlobalStatistics, fetchPoolStatistics } from "../services/asp.js";
import { CLIError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { printJsonSuccess } from "../utils/json.js";
import { printTable, spinner } from "../utils/format.js";
import type {
  GlobalOptions,
  TimeBasedStatistics,
  PoolStatisticsResponse,
  GlobalStatisticsResponse,
} from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";

interface PoolStatsCommandOptions {
  asset?: string;
}

function parseUsd(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    }
  }
  return "-";
}

function parseCount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value).toLocaleString("en-US");
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed).toLocaleString("en-US");
    }
  }
  return "-";
}

function renderStatsTable(
  allTime: TimeBasedStatistics | undefined,
  last24h: TimeBasedStatistics | undefined
): void {
  printTable(
    ["Metric", "All Time", "Last 24h"],
    [
      ["Current TVL", parseUsd(allTime?.tvlUsd), parseUsd(last24h?.tvlUsd)],
      ["Avg Deposit Size", parseUsd(allTime?.avgDepositSizeUsd), parseUsd(last24h?.avgDepositSizeUsd)],
      ["Total Deposits", parseCount(allTime?.totalDepositsCount), parseCount(last24h?.totalDepositsCount)],
      ["Total Withdrawals", parseCount(allTime?.totalWithdrawalsCount), parseCount(last24h?.totalWithdrawalsCount)],
    ]
  );
}

export function createStatsCommand(): Command {
  const command = new Command("stats")
    .description("Show public statistics (global or per pool)")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools stats global\n  privacy-pools stats pool --asset ETH\n  privacy-pools stats pool --asset USDC --json --chain ethereum\n"
    );

  command
    .command("global", { isDefault: true })
    .description("Show global Privacy Pools statistics (all-time and last 24h)")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools stats global\n  privacy-pools stats global --json --chain ethereum\n"
        + commandHelpText({
          jsonFields: "{ mode, chain, cacheTimestamp?, allTime?, last24h? }",
        })
    )
    .action(async (_opts, subCmd) => {
      const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isJson || isQuiet;

      try {
        const config = loadConfig();
        const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
        const spin = spinner("Fetching global statistics...", silent);
        spin.start();
        const stats: GlobalStatisticsResponse = await fetchGlobalStatistics(chainConfig);
        spin.stop();

        if (isJson) {
          printJsonSuccess(
            {
              mode: "global-stats",
              chain: chainConfig.name,
              cacheTimestamp: stats.cacheTimestamp ?? null,
              allTime: stats.allTime ?? null,
              last24h: stats.last24h ?? null,
            },
            false
          );
          return;
        }

        if (!silent) {
          process.stderr.write(`\nGlobal statistics (${chainConfig.name} endpoint):\n\n`);
          renderStatsTable(stats.allTime, stats.last24h);
        }
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
      "\nExamples:\n  privacy-pools stats pool --asset ETH\n  privacy-pools stats pool --asset USDC --json --chain ethereum\n"
        + commandHelpText({
          jsonFields: "{ mode, chain, asset, pool, scope, cacheTimestamp?, allTime?, last24h? }",
        })
    )
    .action(async (opts: PoolStatsCommandOptions, subCmd) => {
      const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isJson || isQuiet;

      try {
        if (!opts.asset) {
          throw new CLIError(
            "Missing required --asset <symbol|address>.",
            "INPUT",
            "Example: privacy-pools stats pool --asset ETH --chain sepolia"
          );
        }

        const config = loadConfig();
        const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
        const pool = await resolvePool(chainConfig, opts.asset, globalOpts?.rpcUrl);

        const spin = spinner("Fetching pool statistics...", silent);
        spin.start();
        const stats: PoolStatisticsResponse = await fetchPoolStatistics(chainConfig, pool.scope);
        spin.stop();

        if (isJson) {
          printJsonSuccess(
            {
              mode: "pool-stats",
              chain: chainConfig.name,
              asset: pool.symbol,
              pool: pool.pool,
              scope: pool.scope.toString(),
              cacheTimestamp: stats.cacheTimestamp ?? null,
              allTime: stats.pool?.allTime ?? null,
              last24h: stats.pool?.last24h ?? null,
            },
            false
          );
          return;
        }

        if (!silent) {
          process.stderr.write(`\nPool statistics for ${pool.symbol} on ${chainConfig.name}:\n\n`);
          renderStatsTable(stats.pool?.allTime, stats.pool?.last24h);
        }
      } catch (error) {
        printError(error, isJson);
      }
    });

  return command;
}
