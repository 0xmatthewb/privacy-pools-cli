import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { formatUnits } from "viem";
import { accent, notice, spinnerColor, successTone } from "./theme.js";

function supportsUnicodeOutput(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const term = env.TERM?.trim().toLowerCase();
  if (term === "dumb") {
    return false;
  }

  const locale = (env.LC_ALL ?? env.LANG ?? "").toUpperCase();
  if (locale.includes("UTF-8") || locale.includes("UTF8")) {
    return true;
  }

  return process.platform !== "win32";
}

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
  const columns = process.stderr.columns ?? process.stdout.columns ?? 120;
  const widthClass = columns <= 72 ? "narrow" : columns <= 90 ? "compact" : "wide";
  const widths = headers.map((header, index) =>
    rows.reduce(
      (max, row) => Math.max(max, visibleWidth(row[index] ?? "")),
      visibleWidth(header),
    ),
  );
  const estimatedWidth =
    widths.reduce((total, width) => total + width, 0) + (headers.length * 3) + 1;

  if (rows.length > 0 && (widthClass === "narrow" || estimatedWidth > columns)) {
    process.stderr.write(formatStackedTable(headers, rows));
    return;
  }

  const table = new Table({
    head: headers.map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
    ...(supportsUnicodeOutput()
      ? {}
      : {
          chars: {
            top: "-",
            "top-mid": "+",
            "top-left": "+",
            "top-right": "+",
            bottom: "-",
            "bottom-mid": "+",
            "bottom-left": "+",
            "bottom-right": "+",
            left: "|",
            "left-mid": "+",
            mid: "-",
            "mid-mid": "+",
            right: "|",
            "right-mid": "+",
            middle: "|",
          },
        }),
  });

  for (const row of rows) {
    table.push(row);
  }

  process.stderr.write(table.toString() + "\n");
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

function visibleWidth(value: string): number {
  return stripAnsiCodes(value).length;
}

function stripAnsiCodes(value: string): string {
  return value.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

export function spinner(text: string, quiet: boolean = false) {
  return ora({ text, color: spinnerColor, stream: process.stderr, isSilent: quiet });
}

export function success(message: string, quiet: boolean = false): void {
  if (quiet) return;
  const prefix = supportsUnicodeOutput() ? "✓" : "ok";
  process.stderr.write(`${successTone(`${prefix} ${message}`)}\n`);
}

export function warn(message: string, quiet: boolean = false): void {
  if (quiet) return;
  const prefix = supportsUnicodeOutput() ? "⚠" : "!";
  process.stderr.write(`${notice(`${prefix} ${message}`)}\n`);
}

export function info(message: string, quiet: boolean = false): void {
  if (quiet) return;
  const prefix = supportsUnicodeOutput() ? "ℹ" : "i";
  process.stderr.write(`${accent(`${prefix} ${message}`)}\n`);
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
  process.stderr.write(`\n${chalk.bold(`[Step ${step}/${total}]`)} ${label}\n`);
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
