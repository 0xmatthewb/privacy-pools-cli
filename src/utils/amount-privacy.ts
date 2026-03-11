/**
 * Privacy guard: detects non-round deposit/withdraw amounts that could
 * fingerprint transactions in the anonymity set.
 *
 * "Round" is asset-aware:
 *   - Stablecoins (USDC, USDT, DAI, …): whole numbers only (0 decimal places)
 *   - Volatile assets (ETH, WETH, …): ≤ 2 decimal places
 *
 * Suggestions always floor toward zero so they never exceed the user's
 * original amount — guaranteeing balance-safety without an extra RPC call.
 */

// ---------------------------------------------------------------------------
// Stablecoin classification
// ---------------------------------------------------------------------------

const KNOWN_STABLECOINS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "FRAX",
  "LUSD",
  "GUSD",
  "USDP",
  "TUSD",
  "BUSD",
  "PYUSD",
  "CRVUSD",
  "GHO",
  "USDS",
  "USDE",
  "EURC",
]);

export function isStablecoin(symbol: string): boolean {
  return KNOWN_STABLECOINS.has(symbol.toUpperCase());
}

// ---------------------------------------------------------------------------
// Roundness detection
// ---------------------------------------------------------------------------

/**
 * Determine how many decimal places the human-readable amount has.
 *
 * Works from the raw bigint + token decimals to avoid floating-point drift.
 */
function decimalPlaces(amount: bigint, decimals: number): number {
  if (decimals === 0) return 0;
  const divisor = 10n ** BigInt(decimals);
  const remainder = amount % divisor;
  if (remainder === 0n) return 0;

  // Count trailing zeros in the remainder to find effective decimal places
  let rem = remainder;
  let trailingZeros = 0;
  while (rem > 0n && rem % 10n === 0n) {
    rem /= 10n;
    trailingZeros++;
  }
  return decimals - trailingZeros;
}

/**
 * Returns true when the amount is "round" for the given asset.
 *
 * - Stablecoins: must be a whole number (0 decimal places)
 * - Volatile: must have ≤ 2 decimal places
 */
export function isRoundAmount(
  amount: bigint,
  decimals: number,
  symbol: string,
): boolean {
  const dp = decimalPlaces(amount, decimals);
  const maxDp = isStablecoin(symbol) ? 0 : 2;
  return dp <= maxDp;
}

// ---------------------------------------------------------------------------
// Suggestion algorithm
// ---------------------------------------------------------------------------

/**
 * Suggest nearby round amounts that are ≤ the original (floor-only).
 *
 * Returns up to `maxSuggestions` alternatives, sorted closest-first.
 */
export function suggestRoundAmounts(
  amount: bigint,
  decimals: number,
  symbol: string,
  maxSuggestions = 3,
): bigint[] {
  if (isRoundAmount(amount, decimals, symbol)) return [];

  const candidates = new Set<bigint>();
  const unit = 10n ** BigInt(decimals);

  if (isStablecoin(symbol)) {
    // Floor to whole number
    const floored = (amount / unit) * unit;
    if (floored > 0n) candidates.add(floored);
  } else {
    // Volatile asset: floor to various precisions
    const dp2 = 10n ** BigInt(Math.max(decimals - 2, 0)); // 2 decimal places
    const dp1 = 10n ** BigInt(Math.max(decimals - 1, 0)); // 1 decimal place

    // Floor to 2dp
    const floor2dp = (amount / dp2) * dp2;
    if (floor2dp > 0n) candidates.add(floor2dp);

    // Floor to 1dp
    const floor1dp = (amount / dp1) * dp1;
    if (floor1dp > 0n) candidates.add(floor1dp);

    // Floor to step grids: 0.05, 0.1, 0.25, 0.5 in token units
    const stepGrids = [
      (unit * 5n) / 100n,   // 0.05
      (unit * 10n) / 100n,  // 0.1
      (unit * 25n) / 100n,  // 0.25
      (unit * 50n) / 100n,  // 0.5
    ];

    for (const step of stepGrids) {
      if (step === 0n) continue;
      const floored = (amount / step) * step;
      if (floored > 0n) candidates.add(floored);
    }

    // Floor to whole number
    const wholeFloored = (amount / unit) * unit;
    if (wholeFloored > 0n) candidates.add(wholeFloored);
  }

  // Filter: remove original amount, remove values that don't pass isRoundAmount
  const valid = Array.from(candidates)
    .filter((c) => c !== amount && isRoundAmount(c, decimals, symbol));

  // Deduplicate (Set handles this) and sort by distance from original (closest first)
  valid.sort((a, b) => {
    const distA = amount - a; // always positive since we floor
    const distB = amount - b;
    if (distA < distB) return -1;
    if (distA > distB) return 1;
    return 0;
  });

  return valid.slice(0, maxSuggestions);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a bigint amount as a human-readable decimal string using the given
 * token decimals.  Strips trailing zeros.
 */
export function formatAmountDecimal(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();

  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;

  if (frac === 0n) return whole.toString();

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

interface WithdrawalPrivacyTipInput {
  amount: bigint;
  balance: bigint;
  decimals: number;
  symbol: string;
}

export function buildWithdrawalPrivacyTip({
  amount,
  balance,
  decimals,
  symbol,
}: WithdrawalPrivacyTipInput): string | null {
  if (isRoundAmount(amount, decimals, symbol)) {
    return null;
  }

  const humanAmount = formatAmountDecimal(amount, decimals);
  const isFullBalance = amount === balance;

  if (isFullBalance) {
    const roundSuggestions = suggestRoundAmounts(amount, decimals, symbol)
      .slice(0, 2)
      .map((suggestion) => `${formatAmountDecimal(suggestion, decimals)} ${symbol}`)
      .join(" + ");
    const alternatives = roundSuggestions || "smaller round amounts";
    return `Tip: withdrawing the full ${humanAmount} ${symbol} links this withdrawal to your deposit. Consider round partial withdrawals (e.g., ${alternatives}) for better privacy.`;
  }

  const suggestions = suggestRoundAmounts(amount, decimals, symbol);
  if (suggestions.length === 0) {
    return null;
  }

  return `Tip: ${humanAmount} ${symbol} may be identifiable. Consider ${suggestions.map((suggestion) => formatAmountDecimal(suggestion, decimals)).join(" or ")} ${symbol} for better privacy.`;
}

export function writeWithdrawalPrivacyTip(
  input: WithdrawalPrivacyTipInput,
  options: {
    silent?: boolean;
    write?: (message: string) => void;
  } = {},
): void {
  if (options.silent) {
    return;
  }

  const tip = buildWithdrawalPrivacyTip(input);
  if (!tip) {
    return;
  }

  (options.write ?? ((message: string) => {
    process.stderr.write(message);
  }))(`${tip}\n`);
}
