import chalk from "chalk";
import ora, { type Ora } from "ora";
import { formatUnits } from "viem";
import {
  accent,
  directionDeposit,
  explorerUrl,
  notice,
  spinnerColor,
  successTone,
  txHash,
} from "./theme.js";
import {
  getOutputWidthClass,
  getTerminalColumns,
  padDisplay,
  supportsUnicodeOutput,
  visibleWidth,
} from "./terminal.js";
import { glyph } from "./symbols.js";

/**
 * Number of fractional digits to show when formatting token amounts.
 * Currently fixed at 2 for all tokens; accepts the token's native decimal
 * count so we can branch later (e.g. show more digits for 18-decimal tokens).
 */
export function displayDecimals(_tokenDecimals: number): number {
  return 2;
}

/**
 * Truncate a formatted decimal string to at most `max` fractional digits,
 * trimming trailing zeros.  When the integer part is "0" and truncation
 * would lose all significant digits (e.g. 0.0005 → 0.00), we extend to
 * include the first non-zero digit so small values stay visible.
 */
function truncateDecimals(value: string, max: number): string {
  const dot = value.indexOf(".");
  if (dot === -1) return value;

  const intPart = value.slice(0, dot);
  const decPart = value.slice(dot + 1);

  if (decPart.length <= max) {
    const trimmed = decPart.replace(/0+$/, "");
    return trimmed.length > 0 ? `${intPart}.${trimmed}` : intPart;
  }

  let digits = max;

  // For fractional-only values, ensure at least the first significant digit
  // is visible (e.g. 0.0005 keeps 4 digits rather than truncating to "0").
  if (intPart === "0" && /^0*$/.test(decPart.slice(0, max))) {
    const firstSig = decPart.search(/[1-9]/);
    if (firstSig >= 0 && firstSig >= max) {
      digits = firstSig + 1;
    }
  }

  const truncated = decPart.slice(0, digits);
  const trimmed = truncated.replace(/0+$/, "");
  return trimmed.length > 0 ? `${intPart}.${trimmed}` : intPart || "0";
}

export function formatAmount(
  value: bigint,
  decimals: number,
  symbol?: string,
  maxDecimals?: number,
): string {
  let formatted = formatUnits(value, decimals);
  if (maxDecimals !== undefined) {
    formatted = truncateDecimals(formatted, maxDecimals);
  }
  return symbol ? `${formatted} ${symbol}` : formatted;
}

// ── USD helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a raw USD string (from ASP) into a formatted dollar string.
 * Returns "-" when the value is missing or unparseable.
 */
export function parseUsd(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    }
  }
  return "-";
}

/**
 * Derive an implied token price (USD per whole token) from a pool's aggregate
 * USD and native-token values.  Returns `null` when the data is insufficient.
 */
export function deriveTokenPrice(
  pool: { decimals: number; acceptedDepositsValue?: bigint; acceptedDepositsValueUsd?: string; totalInPoolValue?: bigint; totalInPoolValueUsd?: string },
): number | null {
  const usdStr = pool.acceptedDepositsValueUsd ?? pool.totalInPoolValueUsd;
  const tokenVal = pool.acceptedDepositsValue ?? pool.totalInPoolValue;
  if (!usdStr || tokenVal === undefined || tokenVal === 0n) return null;

  const usd = Number(usdStr.replace(/,/g, ""));
  const tokens = Number(formatUnits(tokenVal, pool.decimals));
  if (!Number.isFinite(usd) || !Number.isFinite(tokens) || tokens === 0) return null;
  return usd / tokens;
}

/**
 * Format a token amount as a USD string using a pre-derived price.
 * Returns "-" when the price is unavailable.
 */
export function formatUsdValue(
  tokenAmount: bigint,
  decimals: number,
  price: number | null,
): string {
  if (price === null) return "-";
  const tokens = Number(formatUnits(tokenAmount, decimals));
  const usd = tokens * price;
  if (!Number.isFinite(usd)) return "-";
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Returns true when the derived price suggests a USD-pegged stablecoin,
 * making a USD annotation redundant.
 */
export function isStablecoinPrice(price: number | null): boolean {
  if (price === null) return false;
  return price >= 0.90 && price <= 1.10;
}

/**
 * Build a parenthesized approximate USD suffix for confirmation prompts.
 * Returns "" when USD data is unavailable or the token is a stablecoin.
 */
export function usdSuffix(
  amount: bigint,
  decimals: number,
  price: number | null,
): string {
  if (price === null || isStablecoinPrice(price)) return "";
  const formatted = formatUsdValue(amount, decimals, price);
  if (formatted === "-") return "";
  return ` (~${formatted})`;
}

// ── Address / hash helpers ──────────────────────────────────────────────────

export function formatAddress(address: string, chars: number = 6): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatBPS(bps: bigint | string | number): string {
  const percent = Number(bps) / 100;
  return `${percent.toFixed(2)}%`;
}

export function formatTxHash(hash: string): string {
  return formatAddress(hash, 8);
}

export function printTable(
  headers: string[],
  rows: string[][]
): void {
  const columns = getTerminalColumns();
  const widthClass = getOutputWidthClass(columns);
  const widths = headers.map((header, index) =>
    rows.reduce(
      (max, row) => Math.max(max, visibleWidth(row[index] ?? "")),
      visibleWidth(header),
    ),
  );
  const gap = "   ";
  const estimatedWidth =
    widths.reduce((total, width) => total + width, 0) +
    gap.length * Math.max(0, headers.length - 1) +
    2;

  if (rows.length > 0 && (widthClass === "narrow" || estimatedWidth > columns)) {
    process.stderr.write(formatStackedTable(headers, rows));
    return;
  }

  const fill = supportsUnicodeOutput() ? "─" : "-";
  const headerRow = `  ${headers
    .map((header, index) => chalk.bold(padDisplay(header, widths[index])))
    .join(gap)}`;
  const underlineRow = `  ${widths
    .map((width) => chalk.dim(fill.repeat(width)))
    .join(gap)}`;
  const bodyRows = rows.map(
    (row) =>
      `  ${row
        .map((cell, index) => padDisplay(cell ?? "-", widths[index]))
        .join(gap)}`,
  );

  process.stderr.write(`${headerRow}\n${underlineRow}\n${bodyRows.join("\n")}\n`);
}

function formatStackedTable(headers: string[], rows: string[][]): string {
  return `${rows
    .map((row) =>
      headers
        .map((header, index) =>
          `  ${chalk.dim(header)}\n    ${row[index] && row[index].length > 0 ? row[index] : "-"}`
        )
        .join("\n"),
    )
    .join("\n\n")}\n`;
}

/** Format elapsed milliseconds into a compact label like "1.2s" or "342ms". */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
}

/**
 * Format a future epoch-ms deadline as a compact remaining-time label.
 * Returns e.g. "2m 15s", "45s", or "expired" when the deadline has passed.
 */
export function formatRemainingTime(deadlineMs: number, nowMs: number = Date.now()): string {
  const remainMs = deadlineMs - nowMs;
  if (remainMs <= 0) return "expired";
  const totalSec = Math.floor(remainMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Wrap an Ora-like spinner to automatically append elapsed time
 * on succeed() and fail() calls.
 */
function withElapsedTracking<T extends Ora>(spin: T): T {
  // Use performance.now() to avoid interference with Date.now() mocks in tests.
  let startTime = performance.now();
  const originalStart = spin.start.bind(spin);
  const originalSucceed = spin.succeed.bind(spin);
  const originalFail = spin.fail.bind(spin);

  spin.start = function (message?: string) {
    startTime = performance.now();
    return originalStart(message);
  } as typeof spin.start;

  spin.succeed = function (message?: string) {
    const elapsed = performance.now() - startTime;
    const msg = message ?? spin.text;
    if (msg && elapsed >= 250) {
      return originalSucceed(`${msg} ${chalk.dim(`(${formatElapsed(Math.round(elapsed))})`)}`);
    }
    return originalSucceed(message);
  } as typeof spin.succeed;

  spin.fail = function (message?: string) {
    const elapsed = performance.now() - startTime;
    const msg = message ?? spin.text;
    if (msg && elapsed >= 250) {
      return originalFail(`${msg} ${chalk.dim(`(${formatElapsed(Math.round(elapsed))})`)}`);
    }
    return originalFail(message);
  } as typeof spin.fail;

  return spin;
}

function createStaticSpinner(text: string, quiet: boolean): Ora {
  let currentText = text;
  let spinning = false;

  const writeLine = (message: string) => {
    if (quiet || message.length === 0) return;
    process.stderr.write(`${message}\n`);
  };

  const staticSpinner = {
    get text() {
      return currentText;
    },
    set text(value: string) {
      currentText = value;
      if (spinning) {
        writeLine(currentText);
      }
    },
    get isSpinning() {
      return spinning;
    },
    start(message?: string) {
      if (typeof message === "string") {
        currentText = message;
      }
      spinning = true;
      writeLine(currentText);
      return staticSpinner;
    },
    stop() {
      spinning = false;
      return staticSpinner;
    },
    succeed(message?: string) {
      if (typeof message === "string") {
        currentText = message;
      }
      spinning = false;
      writeLine(currentText);
      return staticSpinner;
    },
    fail(message?: string) {
      if (typeof message === "string") {
        currentText = message;
      }
      spinning = false;
      writeLine(currentText);
      return staticSpinner;
    },
    render() {
      return staticSpinner;
    },
  };

  return staticSpinner as unknown as Ora;
}

// Module-level flag: when true, spinner() returns a silent/static spinner.
let _suppressProgress = false;
/** Called by resolveGlobalMode() when --no-progress is active. */
export function setSuppressProgress(value: boolean): void {
  _suppressProgress = value;
}

export function spinner(text: string, quiet: boolean = false) {
  if (_suppressProgress || process.env.PRIVACY_POOLS_CLI_STATIC_SPINNER === "1") {
    return withElapsedTracking(createStaticSpinner(text, _suppressProgress || quiet) as Ora);
  }

  return withElapsedTracking(ora({
    text,
    color: spinnerColor,
    stream: process.stderr,
    isSilent: quiet,
    discardStdin: false,
  }));
}

export function success(message: string, quiet: boolean = false): void {
  if (quiet) return;
  process.stderr.write(`${successTone(`${glyph("active")} ${message}`)}\n`);
}

export function warn(message: string, quiet: boolean = false): void {
  if (quiet) return;
  process.stderr.write(`${notice(`${glyph("active")} ${message}`)}\n`);
}

export function info(message: string, quiet: boolean = false): void {
  if (quiet) return;
  process.stderr.write(`${accent(`${glyph("active")} ${message}`)}\n`);
}

export function verbose(
  message: string,
  isVerbose: boolean,
  quiet: boolean = false
): void {
  if (isVerbose && !quiet) {
    process.stderr.write(`${chalk.dim(message)}\n`);
  }
}

export function stageHeader(
  step: number,
  total: number,
  label: string,
  quiet: boolean = false,
): void {
  if (quiet) return;
  process.stderr.write(
    `\n${accent(`${glyph("current")} ${label}`)} ${chalk.dim(`(${step}/${total})`)}\n`,
  );
}

export function formatDenseOutcomeLine(params: {
  outcome: "deposit" | "withdraw" | "recovery" | "success";
  message: string;
  url?: string | null;
}): string {
  const colorFn = (() => {
    switch (params.outcome) {
      case "deposit":
        return directionDeposit;
      case "withdraw":
        return accent;
      case "recovery":
        return notice;
      default:
        return successTone;
    }
  })();

  const lines = [`  ${chalk.bold(colorFn(params.message))}`];
  if (params.url) {
    lines.push(`    ${explorerUrl(params.url)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatExplorerHash(value: string): string {
  return txHash(formatAddress(value, 8));
}

/** Format a millisecond timestamp as a relative "Xh ago" label. */
export function formatTimeAgo(timestampMs: number | null): string {
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

/**
 * Approximate relative time from a block number, using average block time.
 * @param currentBlock Latest block on chain
 * @param eventBlock Block at which the event occurred
 * @param avgBlockTimeSec Average seconds per block (default 12 for Ethereum)
 */
export function formatApproxBlockTimeAgo(
  currentBlock: bigint,
  eventBlock: bigint,
  avgBlockTimeSec: number = 12,
): string {
  if (eventBlock > currentBlock) return "just now";
  const blockDelta = Number(currentBlock - eventBlock);
  const deltaMs = blockDelta * avgBlockTimeSec * 1000;
  return formatTimeAgo(Date.now() - deltaMs);
}

// ── Multi-level verbose helpers ───────────────────────────────────────────────

/**
 * Level-2 debug output (requires -vv). Prints `[debug] message` in dim style.
 */
export function verboseL2(
  message: string,
  verboseLevel: number,
  quiet: boolean = false,
): void {
  if (quiet || verboseLevel < 2) return;
  process.stderr.write(`${chalk.dim(`[debug] ${message}`)}\n`);
}

/**
 * Level-3 trace output (requires -vvv). Prints `[trace] message` in dim style.
 */
export function verboseL3(
  message: string,
  verboseLevel: number,
  quiet: boolean = false,
): void {
  if (quiet || verboseLevel < 3) return;
  process.stderr.write(`${chalk.dim(`[trace] ${message}`)}\n`);
}
