/**
 * Centralised CLI colour palette.
 *
 * Every file that needs an accent colour should import from here so the
 * palette can be tweaked in one place.
 */

import chalk from "chalk";

// ── Accent colours ────────────────────────────────────────────────────────────

/** Steel blue — banner art, command examples, section headers. */
export const accent = chalk.hex("#5AADD6");

/** Bold variant for section headings (e.g. "Usage:", "Quick Guide"). */
export const accentBold = chalk.bold.hex("#5AADD6");

/** Warm gold bold — logo and wordmark branding. */
export const brand = chalk.bold.hex("#D4A030");

/** Muted amber — warnings, hints, and cautionary help text. */
export const notice = chalk.hex("#CA8A2E");

/** Vivid green — success messages and approved/spendable states. */
export const successTone = chalk.hex("#22C55E");

/** Muted red — errors and declined states. */
export const dangerTone = chalk.hex("#E85D5D");

/** Ora spinner colour name closest to the accent (used by ora's `color` opt). */
export const spinnerColor = "cyan" as const;

/** Semantic wrappers so renderers style by meaning instead of raw color names. */
export const amount = chalk.bold;
export const txHash = chalk.dim;
export const chainName = accent;
export const poolAsset = accent;
export const explorerUrl = chalk.underline;
export const statusHealthy = successTone;
export const statusPending = notice;
export const statusFailed = dangerTone;
export const directionDeposit = successTone;
export const directionWithdraw = accent;
export const directionRecovery = notice;
