/**
 * Centralised CLI colour palette.
 *
 * Every file that needs an accent colour should import from here so the
 * palette can be tweaked in one place.
 */

import chalk from "chalk";

// ── Accent colours ────────────────────────────────────────────────────────────

/** Steel-blue — banner art, command examples, section headers. */
export const accent = chalk.hex("#5B9BD5");

/** Bold variant for section headings (e.g. "Usage:", "Quick Guide"). */
export const accentBold = chalk.bold.hex("#5B9BD5");

/** Muted amber — success marks, command names, positive-status indicators. */
export const highlight = chalk.hex("#D4944A");

/** Pale pink — arguments and parameter names in help text. */
export const subtle = chalk.hex("#C48B9F");

/** Ora spinner colour name closest to the accent (used by ora's `color` opt). */
export const spinnerColor = "cyan" as const;
