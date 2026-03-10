import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { getDefaultReadOnlyChains } from "../config/chains.js";
import { resolvePool } from "../services/pools.js";
import { fetchGlobalEvents, fetchPoolEvents } from "../services/asp.js";
import { CLIError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { formatAmount, displayDecimals, spinner, formatTimeAgo } from "../utils/format.js";
import type { GlobalOptions, AspPublicEvent } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderActivity } from "../output/activity.js";
import type { NormalizedActivityEvent } from "../output/activity.js";

interface ActivityCommandOptions {
  asset?: string;
  page?: string;
  limit?: string;
}

/** @internal Exported for unit testing. */
export function parsePositiveInt(raw: string | undefined, fieldName: string): number {
  const fallback = fieldName === "page" ? 1 : 12;
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CLIError(
      `Invalid --${fieldName} value: ${raw}.`,
      "INPUT",
      `--${fieldName} must be a positive integer.`
    );
  }
  return parsed;
}

/** @internal Exported for unit testing. */
export function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toMsTimestamp(value: unknown): number | null {
  const parsed = parseNumberish(value);
  if (parsed === null) return null;
  return parsed < 1e12 ? Math.floor(parsed * 1000) : Math.floor(parsed);
}

function normalizeActivityEvent(
  event: AspPublicEvent,
  fallbackSymbol?: string
): NormalizedActivityEvent {
  const pool = event.pool ?? {};
  const chainId = parseNumberish(pool.chainId);
  const amountRaw =
    typeof event.amount === "string"
      ? event.amount
      : typeof event.publicAmount === "string"
        ? event.publicAmount
        : null;

  const symbol =
    typeof pool.tokenSymbol === "string" && pool.tokenSymbol.trim() !== ""
      ? pool.tokenSymbol
      : fallbackSymbol ?? null;
  const decimals = parseNumberish(pool.denomination) ?? 18;

  let amountFormatted = "-";
  if (amountRaw && /^-?\d+$/.test(amountRaw)) {
    try {
      amountFormatted = formatAmount(BigInt(amountRaw), decimals, symbol ?? undefined, displayDecimals(decimals));
    } catch {
      amountFormatted = amountRaw;
    }
  } else if (amountRaw) {
    amountFormatted = amountRaw;
  }

  const timestampMs = toMsTimestamp(event.timestamp);

  return {
    type: typeof event.type === "string" ? event.type : "unknown",
    txHash: typeof event.txHash === "string" ? event.txHash : null,
    reviewStatus: typeof event.reviewStatus === "string" ? event.reviewStatus : null,
    amountRaw,
    amountFormatted,
    timestampMs,
    timeLabel: formatTimeAgo(timestampMs),
    poolSymbol: symbol,
    poolAddress: typeof pool.poolAddress === "string" ? pool.poolAddress : null,
    chainId,
  };
}

export function createActivityCommand(): Command {
  const metadata = getCommandMetadata("activity");
  return new Command("activity")
    .description(metadata.description)
    .option("-a, --asset <symbol|address>", "Filter to one pool asset on the selected chain")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Items per page", "12")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (opts: ActivityCommandOptions, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isQuiet || isJson;

      try {
        const page = parsePositiveInt(opts.page, "page");
        const perPage = parsePositiveInt(opts.limit, "limit");
        const explicitChain = globalOpts?.chain;

        const config = loadConfig();
        const ctx = createOutputContext(mode);
        const spin = spinner("Fetching public activity...", silent);
        spin.start();

        // --asset requires a single chain for pool resolution
        if (opts.asset) {
          const chainConfig = resolveChain(explicitChain, config.defaultChain);
          const pool = await resolvePool(chainConfig, opts.asset, globalOpts?.rpcUrl);
          const response = await fetchPoolEvents(
            chainConfig,
            pool.scope,
            page,
            perPage
          );
          spin.stop();

          const eventsRaw = Array.isArray(response.events) ? response.events : [];
          const events = eventsRaw.map((e) => normalizeActivityEvent(e, pool.symbol));

          renderActivity(ctx, {
            mode: "pool-activity",
            chain: chainConfig.name,
            page: parseNumberish(response.page) ?? page,
            perPage: parseNumberish(response.perPage) ?? perPage,
            total: parseNumberish(response.total) ?? null,
            totalPages: parseNumberish(response.totalPages) ?? null,
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
          const chainsToQuery = getDefaultReadOnlyChains();
          const chainNames = chainsToQuery.map((c) => c.name);
          const representativeChain = chainsToQuery[0];

          const response = await fetchGlobalEvents(representativeChain, page, perPage);
          spin.stop();

          const eventsRaw = Array.isArray(response.events) ? response.events : [];
          const events = eventsRaw.map((e) => normalizeActivityEvent(e));

          renderActivity(ctx, {
            mode: "global-activity",
            chain: "all-mainnets",
            chains: chainNames,
            page: parseNumberish(response.page) ?? page,
            perPage: parseNumberish(response.perPage) ?? perPage,
            total: parseNumberish(response.total) ?? null,
            totalPages: parseNumberish(response.totalPages) ?? null,
            events,
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
          page: parseNumberish(response.page) ?? page,
          perPage: parseNumberish(response.perPage) ?? perPage,
          total: null,
          totalPages: null,
          events,
          chainFiltered: true,
        });
      } catch (error) {
        printError(error, isJson);
      }
    });
}
