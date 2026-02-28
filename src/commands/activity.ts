import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { resolvePool } from "../services/pools.js";
import { fetchGlobalEvents, fetchPoolEvents } from "../services/asp.js";
import { CLIError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { printJsonSuccess } from "../utils/json.js";
import { formatAddress, formatAmount, printTable, spinner } from "../utils/format.js";
import type { GlobalOptions, AspPublicEvent } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";

interface ActivityCommandOptions {
  asset?: string;
  page?: string;
  limit?: string;
}

interface NormalizedActivityEvent {
  type: string;
  txHash: string | null;
  reviewStatus: string | null;
  amountRaw: string | null;
  amountFormatted: string;
  timestampMs: number | null;
  timeLabel: string;
  poolSymbol: string | null;
  poolAddress: string | null;
  chainId: number | null;
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

function formatTimeAgo(timestampMs: number | null): string {
  if (timestampMs === null) return "-";
  const delta = Math.max(0, Date.now() - timestampMs);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
      amountFormatted = formatAmount(BigInt(amountRaw), decimals, symbol ?? undefined);
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

function eventPoolLabel(event: NormalizedActivityEvent): string {
  if (event.poolSymbol && event.chainId !== null) {
    return `${event.poolSymbol}@${event.chainId}`;
  }
  if (event.poolSymbol) return event.poolSymbol;
  if (event.chainId !== null) return `chain-${event.chainId}`;
  return "-";
}

export function createActivityCommand(): Command {
  return new Command("activity")
    .description("Show public activity feed (global or for a specific pool)")
    .option("-a, --asset <symbol|address>", "Filter to one pool asset on the selected chain")
    .option("--page <n>", "Page number", "1")
    .option("--limit <n>", "Items per page", "12")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools activity\n  privacy-pools activity --page 2 --limit 20\n  privacy-pools activity --asset ETH\n  privacy-pools activity --asset USDC --json --chain ethereum\n"
        + commandHelpText({
          jsonFields: "{ mode, chain, page, perPage, total?, totalPages?, events: [{ type, txHash, reviewStatus, amountRaw, poolSymbol, poolAddress, chainId, timestamp }] }",
        })
    )
    .action(async (opts: ActivityCommandOptions, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isQuiet || isJson;

      try {
        const page = parsePositiveInt(opts.page, "page");
        const perPage = parsePositiveInt(opts.limit, "limit");

        const config = loadConfig();
        const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);

        const spin = spinner("Fetching public activity...", silent);
        spin.start();

        if (opts.asset) {
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

          if (isJson) {
            printJsonSuccess(
              {
                mode: "pool-activity",
                chain: chainConfig.name,
                asset: pool.symbol,
                pool: pool.pool,
                scope: pool.scope.toString(),
                page: parseNumberish(response.page) ?? page,
                perPage: parseNumberish(response.perPage) ?? perPage,
                total: parseNumberish(response.total) ?? null,
                totalPages: parseNumberish(response.totalPages) ?? null,
                events: events.map((e) => ({
                  type: e.type,
                  txHash: e.txHash,
                  reviewStatus: e.reviewStatus,
                  amountRaw: e.amountRaw,
                  poolSymbol: e.poolSymbol,
                  poolAddress: e.poolAddress,
                  chainId: e.chainId,
                  timestamp: e.timestampMs,
                })),
              },
              false
            );
            return;
          }

          if (silent) return;
          process.stderr.write(`\nActivity for ${pool.symbol} on ${chainConfig.name}:\n\n`);
          if (events.length === 0) {
            process.stderr.write("No activity found.\n");
            return;
          }

          printTable(
            ["Type", "Pool", "Amount", "Status", "Time", "Tx"],
            events.map((e) => [
              e.type,
              eventPoolLabel(e),
              e.amountFormatted,
              e.reviewStatus ?? "-",
              e.timeLabel,
              e.txHash ? formatAddress(e.txHash, 8) : "-",
            ])
          );
          return;
        }

        const response = await fetchGlobalEvents(chainConfig, page, perPage);
        spin.stop();

        const eventsRaw = Array.isArray(response.events) ? response.events : [];
        const events = eventsRaw.map((e) => normalizeActivityEvent(e));

        if (isJson) {
          printJsonSuccess(
            {
              mode: "global-activity",
              chain: chainConfig.name,
              page: parseNumberish(response.page) ?? page,
              perPage: parseNumberish(response.perPage) ?? perPage,
              total: parseNumberish(response.total) ?? null,
              totalPages: parseNumberish(response.totalPages) ?? null,
              events: events.map((e) => ({
                type: e.type,
                txHash: e.txHash,
                reviewStatus: e.reviewStatus,
                amountRaw: e.amountRaw,
                poolSymbol: e.poolSymbol,
                poolAddress: e.poolAddress,
                chainId: e.chainId,
                timestamp: e.timestampMs,
              })),
            },
            false
          );
          return;
        }

        if (silent) return;
        process.stderr.write(`\nGlobal activity (${chainConfig.name} endpoint):\n\n`);
        if (events.length === 0) {
          process.stderr.write("No activity found.\n");
          return;
        }

        printTable(
          ["Type", "Pool", "Amount", "Status", "Time", "Tx"],
          events.map((e) => [
            e.type,
            eventPoolLabel(e),
            e.amountFormatted,
            e.reviewStatus ?? "-",
            e.timeLabel,
            e.txHash ? formatAddress(e.txHash, 8) : "-",
          ])
        );
      } catch (error) {
        printError(error, isJson);
      }
    });
}
