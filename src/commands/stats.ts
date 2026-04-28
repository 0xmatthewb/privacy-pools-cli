import type { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { resolvePool } from "../services/pools.js";
import { fetchGlobalStatistics, fetchPoolStatistics } from "../services/asp.js";
import { printError } from "../utils/errors.js";
import { inputError } from "../utils/errors/factories.js";
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
import { deprecatedStatsAliasWarning } from "../utils/deprecations.js";

interface PoolStatsCommandOptions {}

type DeprecatedStatsAlias = "stats" | "stats global" | "stats pool";
type GlobalStatsInvocationMetadata = {
  command: "protocol-stats";
  invokedAs?: "stats" | "stats global";
};
type PoolStatsInvocationMetadata = {
  command: "pool-stats";
  invokedAs?: "stats pool";
};

/** @internal Exported for unit testing. */
export { parseUsd, parseCount } from "../output/stats.js";
export {
  createStatsCommand,
  createProtocolStatsCommand,
  createPoolStatsCommand,
} from "../command-shells/stats.js";

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

function buildDeprecatedAliasPayload(
  invokedAs: DeprecatedStatsAlias,
  replacementCommand: string,
): {
  code: string;
  message: string;
  replacementCommand: string;
} {
  return deprecatedStatsAliasWarning(invokedAs, replacementCommand);
}

async function renderGlobalStatsForInvocation(
  subCmd: Command,
  invocation: GlobalStatsInvocationMetadata,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(subCmd);
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;

  try {
    const explicitChain = globalOpts?.chain;
    const silent = isJson || mode.isQuiet || mode.isWide;

    if (explicitChain) {
      throw inputError(
        "INPUT_FLAG_CONFLICT",
        "Global statistics are aggregated across all chains. The --chain flag is not supported for this subcommand.",
        "For chain-specific data use: privacy-pools pool-stats <symbol> --chain <chain>",
      );
    }

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
      command: invocation.command,
      ...(invocation.invokedAs
        ? {
            invokedAs: invocation.invokedAs,
            deprecationWarning: buildDeprecatedAliasPayload(
              invocation.invokedAs,
              "privacy-pools protocol-stats",
            ),
          }
        : {}),
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

async function renderPoolStatsForInvocation(
  positionalAsset: string | undefined,
  subCmd: Command,
  invocation: PoolStatsInvocationMetadata,
): Promise<void> {
  const globalOpts = getRootGlobalOptions(subCmd);
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const silent = mode.isQuiet || isJson || mode.isWide;
  const asset = positionalAsset;

  try {
    if (!asset) {
      throw inputError(
        "INPUT_MISSING_ASSET",
        "Missing asset argument.",
        "Example: privacy-pools pool-stats ETH",
      );
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    const pool = await resolvePool(chainConfig, asset, globalOpts?.rpcUrl);

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
      command: invocation.command,
      ...(invocation.invokedAs
        ? {
            invokedAs: invocation.invokedAs,
            deprecationWarning: buildDeprecatedAliasPayload(
              invocation.invokedAs,
              `privacy-pools pool-stats ${pool.symbol}`,
            ),
          }
        : {}),
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

export async function handleGlobalStatsCommand(
  _opts: unknown,
  subCmd: Command,
): Promise<void> {
  await renderGlobalStatsForInvocation(
    subCmd,
    { command: "protocol-stats" },
  );
}

export async function handleProtocolStatsCommand(
  _opts: unknown,
  subCmd: Command,
): Promise<void> {
  await renderGlobalStatsForInvocation(
    subCmd,
    { command: "protocol-stats" },
  );
}

export async function handleDeprecatedStatsDefaultAliasCommand(
  _opts: unknown,
  subCmd: Command,
): Promise<void> {
  await renderGlobalStatsForInvocation(
    subCmd,
    { command: "protocol-stats", invokedAs: "stats" },
  );
}

export async function handleDeprecatedStatsGlobalAliasCommand(
  _opts: unknown,
  subCmd: Command,
): Promise<void> {
  await renderGlobalStatsForInvocation(
    subCmd,
    { command: "protocol-stats", invokedAs: "stats global" },
  );
}

export async function handlePoolStatsCommand(
  positionalAsset: string | undefined,
  _opts: PoolStatsCommandOptions,
  subCmd: Command,
): Promise<void> {
  await renderPoolStatsForInvocation(
    positionalAsset,
    subCmd,
    { command: "pool-stats" },
  );
}

export async function handleDeprecatedStatsPoolAliasCommand(
  positionalAsset: string | undefined,
  _opts: PoolStatsCommandOptions,
  subCmd: Command,
): Promise<void> {
  await renderPoolStatsForInvocation(
    positionalAsset,
    subCmd,
    { command: "pool-stats", invokedAs: "stats pool" },
  );
}
