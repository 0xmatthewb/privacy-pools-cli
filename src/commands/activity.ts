import type { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import {
  getAllChainsWithOverrides,
  getDefaultReadOnlyChains,
  MULTI_CHAIN_SCOPE_ALL_CHAINS,
  MULTI_CHAIN_SCOPE_ALL_MAINNETS,
} from "../config/chains.js";
import { resolvePool } from "../services/pools.js";
import { fetchGlobalEvents, fetchPoolEvents } from "../services/asp.js";
import { CLIError, printError } from "../utils/errors.js";
import { spinner } from "../utils/format.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderActivity } from "../output/activity.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import {
  normalizeActivityEvent,
  parseNumberish as parseNumberishValue,
} from "../utils/public-activity.js";
import { warnLegacyAllChainsFlag, warnLegacyAssetFlag } from "../utils/deprecations.js";

interface ActivityCommandOptions {
  asset?: string;
  includeTestnets?: boolean;
  allChains?: boolean;
  page?: string;
  limit?: string;
}

export { createActivityCommand } from "../command-shells/activity.js";

/** @internal Exported for unit testing. */
export function parsePositiveInt(
  raw: string | undefined,
  fieldName: string,
): number {
  const fallback = fieldName === "page" ? 1 : 12;
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CLIError(
      `Invalid --${fieldName} value: ${raw}.`,
      "INPUT",
      `--${fieldName} must be a positive integer.`,
    );
  }
  return parsed;
}

export { parseNumberishValue as parseNumberish };

export async function handleActivityCommand(
  positionalAsset: string | undefined,
  opts: ActivityCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const isQuiet = mode.isQuiet;
  const silent = isQuiet || isJson;

  // Resolve positional vs deprecated --asset flag.
  const resolvedAsset = positionalAsset ?? opts.asset;
  if (opts.asset !== undefined && positionalAsset === undefined) {
    warnLegacyAssetFlag("privacy-pools activity <asset> (e.g. privacy-pools activity ETH)", silent);
  }
  if (opts.allChains && !opts.includeTestnets) {
    warnLegacyAllChainsFlag(silent);
  }

  try {
    if (await maybeRenderPreviewScenario("activity")) {
      return;
    }

    const page = parsePositiveInt(opts.page, "page");
    const perPage = parsePositiveInt(opts.limit, "limit");
    const explicitChain = globalOpts?.chain;
    const includeTestnets = opts.includeTestnets === true || opts.allChains === true;

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

    // Asset filter requires a single chain for pool resolution
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
      const events = eventsRaw.map((e) =>
        normalizeActivityEvent(e, pool.symbol),
      );

      renderActivity(ctx, {
        mode: "pool-activity",
        chain: chainConfig.name,
        page: parseNumberishValue(response.page) ?? page,
        perPage: parseNumberishValue(response.perPage) ?? perPage,
        total: parseNumberishValue(response.total) ?? null,
        totalPages: parseNumberishValue(response.totalPages) ?? null,
        events,
        asset: pool.symbol,
        pool: pool.pool,
        scope: pool.scope.toString(),
      });
      return;
    }

    // Global activity: the ASP global endpoint returns cross-chain data,
    // so we call it exactly once regardless of how many chains are configured.
    // Use the first default chain config (for its aspHost).
    if (!explicitChain) {
      const chainsToQuery = includeTestnets
        ? getAllChainsWithOverrides()
        : getDefaultReadOnlyChains();
      const chainNames = chainsToQuery.map((c) => c.name);
      if (!includeTestnets) {
        const representativeChain = chainsToQuery[0];
        const response = await fetchGlobalEvents(
          representativeChain,
          page,
          perPage,
        );
        spin.stop();

        const eventsRaw = Array.isArray(response.events) ? response.events : [];
        const events = eventsRaw.map((e) => normalizeActivityEvent(e));

        renderActivity(ctx, {
          mode: "global-activity",
          chain: MULTI_CHAIN_SCOPE_ALL_MAINNETS,
          chains: chainNames,
          page: parseNumberishValue(response.page) ?? page,
          perPage: parseNumberishValue(response.perPage) ?? perPage,
          total: parseNumberishValue(response.total) ?? null,
          totalPages: parseNumberishValue(response.totalPages) ?? null,
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

    // Single chain global activity: call the global endpoint once and
    // filter results to only events matching the selected chain.
    const chainConfig = resolveChain(explicitChain, config.defaultChain);
    const response = await fetchGlobalEvents(chainConfig, page, perPage);
    spin.stop();

    const eventsRaw = Array.isArray(response.events) ? response.events : [];
    const events = eventsRaw
      .map((e) => normalizeActivityEvent(e))
      .filter((e) => e.chainId === null || e.chainId === chainConfig.id);

    renderActivity(ctx, {
      mode: "global-activity",
      chain: chainConfig.name,
      page: parseNumberishValue(response.page) ?? page,
      perPage: parseNumberishValue(response.perPage) ?? perPage,
      total: null,
      totalPages: null,
      events,
      chainFiltered: true,
    });
  } catch (error) {
    printError(error, isJson);
  }
}
