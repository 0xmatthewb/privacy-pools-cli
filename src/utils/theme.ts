/**
 * Centralised CLI colour palette.
 *
 * Every file that needs an accent colour should import from here so the
 * palette can be tweaked in one place.
 */

import chalk from "chalk";
import { formatHyperlink } from "./terminal.js";

// ── Accent colours ────────────────────────────────────────────────────────────

/** Steel blue — banner art, command examples, section headers. */
export const accent = chalk.hex("#5AADD6");

/** Bold variant for section headings (e.g. "Usage:", "Quick Guide"). */
export const accentBold = chalk.bold.hex("#5AADD6");

/** Warm gold bold — logo and wordmark branding. */
export const brand = chalk.bold.hex("#D4A030");

/** Muted amber — warnings, hints, and cautionary help text. */
export const notice = chalk.hex("#CA8A2E");

/** Clear body-text grey, brighter than chalk.dim on many terminals. */
export const muted = chalk.hex("#A8A8A8");

/** Secondary text grey for supporting labels and low-emphasis copy. */
export const subtle = chalk.hex("#88919F");

/** Faint terminal styling for separators and lowest-emphasis metadata. */
export const faint = chalk.dim;

/** Vivid green — success messages and approved/spendable states. */
export const successTone = chalk.hex("#22C55E");

/** Muted red — errors and declined states. */
export const dangerTone = chalk.hex("#E85D5D");

/** Ora spinner colour name closest to the accent (used by ora's `color` opt). */
export const spinnerColor = "cyan" as const;

/** Semantic wrappers so renderers style by meaning instead of raw color names. */
export const amount = chalk.bold;
export const txHash = faint;
export const chainName = accent;
export const poolAsset = accent;
export const explorerUrl = (url: string): string =>
  formatHyperlink(chalk.underline(url), url);
export const statusHealthy = successTone;
export const statusPending = notice;
export const statusFailed = dangerTone;
export const directionDeposit = successTone;
export const directionWithdraw = accent;
export const directionRecovery = notice;
