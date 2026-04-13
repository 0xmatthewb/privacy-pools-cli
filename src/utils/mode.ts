import type { GlobalOptions } from "../types.js";
import { configureJsonOutput } from "./json.js";
import { setSuppressHeaders, setSuppressProgress } from "./format.js";
import { getParsedVerboseLevel } from "./verbose-level.js";
import { setActiveProfile } from "../runtime/config-paths.js";

export const OUTPUT_FORMATS = ["table", "csv", "json", "wide"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const OUTPUT_FORMAT_SET = new Set<string>(OUTPUT_FORMATS);

export const OUTPUT_FORMAT_DESCRIPTION = `Output format: ${OUTPUT_FORMATS[0]} (default), ${OUTPUT_FORMATS.slice(1).join(", ")}`;
export const OUTPUT_FORMAT_CHOICES_TEXT = OUTPUT_FORMATS.join(", ");
export const OUTPUT_FORMAT_CHOICES_HELP_TEXT = OUTPUT_FORMATS
  .map((value) => `"${value}"`)
  .join(", ");

export interface ResolvedGlobalMode {
  isAgent: boolean;
  isJson: boolean;
  isCsv: boolean;
  isWide: boolean;
  isQuiet: boolean;
  noProgress: boolean;
  noHeader: boolean;
  isVerbose: boolean;
  verboseLevel: number;
  format: OutputFormat;
  skipPrompts: boolean;
  jsonFields: string[] | null;
  jqExpression: string | null;
}

export function normalizeOutputFormat(
  value: string | null | undefined,
): OutputFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return OUTPUT_FORMAT_SET.has(normalized)
    ? (normalized as OutputFormat)
    : null;
}

export function isSupportedOutputFormat(
  value: string | null | undefined,
): boolean {
  return normalizeOutputFormat(value) !== null;
}

export function invalidOutputFormatMessage(value: string): string {
  return `option '--format <format>' argument '${value}' is invalid. Allowed choices are ${OUTPUT_FORMAT_CHOICES_TEXT}.`;
}

export function resolveGlobalMode(
  globalOpts?: GlobalOptions
): ResolvedGlobalMode {
  // Activate profile before any config loading happens.
  if (globalOpts?.profile !== undefined) {
    setActiveProfile(globalOpts.profile);
  }

  const isAgent = globalOpts?.agent ?? false;
  const hasJq = typeof globalOpts?.jq === "string";
  const hasJsonFieldsFlag = typeof globalOpts?.jsonFields === "string";
  const hasStructuredJsonFlag =
    (globalOpts?.json ?? false) || isAgent || hasJq || hasJsonFieldsFlag;
  const explicitFormat = normalizeOutputFormat(globalOpts?.format);
  const isWide = explicitFormat === "wide";
  const format: OutputFormat =
    explicitFormat === "json" || hasStructuredJsonFlag ? "json" :
    explicitFormat === "csv" ? "csv" :
    "table"; // "wide" also uses table rendering
  const isJson = format === "json";
  const isCsv = format === "csv";
  const isQuiet = (globalOpts?.quiet ?? false) || isAgent;
  // JSON/CSV/machine mode must never block on interactive prompts.
  // Also auto-detect CI environments (CI=true or CI=1) to prevent hanging.
  const isCI = process.env.CI === "true" || process.env.CI === "1";
  const skipPrompts = (globalOpts?.yes ?? false) || isAgent || isJson || isCsv || isCI;

  // Parse --json-fields <fields> comma-separated field selection.
  const jsonFields: string[] | null =
    typeof globalOpts?.jsonFields === "string"
      ? globalOpts.jsonFields.split(",").map((f) => f.trim()).filter(Boolean)
      : null;

  // Parse --jq <expression>.
  const jqExpression: string | null = hasJq ? globalOpts!.jq! : null;

  // Persist timeout from global flags for services to pick up.
  if (globalOpts?.timeout !== undefined) {
    setNetworkTimeoutMs(parseTimeoutFlag(globalOpts.timeout));
  }

  // Compute verbose level: supports -v (1), -vv (2), -vvv (3).
  // Commander parses --verbose as boolean, so we read the precise count
  // from the argv parser which counted actual -v occurrences.
  const parsedLevel = getParsedVerboseLevel();
  const verboseLevel = parsedLevel > 0
    ? parsedLevel
    : (globalOpts?.verbose ? 1 : 0);
  const isVerbose = verboseLevel >= 1;

  // --no-progress suppresses spinners but keeps result messages.
  // Commander interprets --no-progress as negation, setting progress=false,
  // while the root-argv parser sets noProgress=true.  Accept both.
  const noProgress =
    globalOpts?.noProgress === true ||
    (globalOpts as Record<string, unknown> | undefined)?.progress === false;
  if (noProgress) {
    setSuppressProgress(true);
  } else {
    setSuppressProgress(false);
  }

  const noHeader =
    globalOpts?.noHeader === true ||
    (globalOpts as Record<string, unknown> | undefined)?.header === false;
  setSuppressHeaders(noHeader);

  // Configure the JSON output module with field selection and jq filtering.
  configureJsonOutput(jsonFields, jqExpression);

  return { isAgent, isJson, isCsv, isWide, isQuiet, noProgress, noHeader, isVerbose, verboseLevel, format, skipPrompts, jsonFields, jqExpression };
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
