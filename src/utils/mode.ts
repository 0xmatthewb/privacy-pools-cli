import type { GlobalOptions } from "../types.js";

export type OutputFormat = "table" | "csv" | "json";

export interface ResolvedGlobalMode {
  isAgent: boolean;
  isJson: boolean;
  isCsv: boolean;
  isQuiet: boolean;
  format: OutputFormat;
  skipPrompts: boolean;
}

export function resolveGlobalMode(
  globalOpts?: GlobalOptions
): ResolvedGlobalMode {
  const isAgent = globalOpts?.agent ?? false;
  const explicitFormat = globalOpts?.format?.toLowerCase() as OutputFormat | undefined;
  const format: OutputFormat =
    explicitFormat === "csv" ? "csv" :
    explicitFormat === "json" || (globalOpts?.json ?? false) || isAgent ? "json" :
    "table";
  const isJson = format === "json";
  const isCsv = format === "csv";
  const isQuiet = (globalOpts?.quiet ?? false) || isAgent;
  // JSON/CSV/machine mode must never block on interactive prompts.
  const skipPrompts = (globalOpts?.yes ?? false) || isAgent || isJson || isCsv;

  // Persist timeout from global flags for services to pick up.
  if (globalOpts?.timeout !== undefined) {
    setNetworkTimeoutMs(parseTimeoutFlag(globalOpts.timeout));
  }

  return { isAgent, isJson, isCsv, isQuiet, format, skipPrompts };
}

const DEFAULT_NETWORK_TIMEOUT_MS = 30_000;
let _networkTimeoutMs = DEFAULT_NETWORK_TIMEOUT_MS;

function parseTimeoutFlag(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_NETWORK_TIMEOUT_MS;
  return Math.round(seconds * 1000);
}

function setNetworkTimeoutMs(ms: number): void {
  _networkTimeoutMs = ms;
}

/** Returns the network timeout in milliseconds (default 30 000). */
export function getNetworkTimeoutMs(): number {
  return _networkTimeoutMs;
}

const MIN_CONFIRMATION_TIMEOUT_MS = 60_000;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 300_000;

/**
 * Returns the timeout for on-chain tx confirmation waits.
 *
 * When `--timeout` is set, uses the larger of the user's value and a
 * safe floor (60 s) so short timeouts intended for health checks don't
 * abort real transaction confirmations.  Without `--timeout` the default
 * is 300 s (unchanged from prior behavior).
 */
export function getConfirmationTimeoutMs(): number {
  if (_networkTimeoutMs === DEFAULT_NETWORK_TIMEOUT_MS) {
    // No explicit --timeout flag was provided; use the legacy 300 s default.
    return DEFAULT_CONFIRMATION_TIMEOUT_MS;
  }
  return Math.max(_networkTimeoutMs, MIN_CONFIRMATION_TIMEOUT_MS);
}
