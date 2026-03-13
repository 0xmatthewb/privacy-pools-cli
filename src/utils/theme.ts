/**
 * Centralised CLI colour palette.
 *
 * Every file that needs an accent colour should import from here so the
 * palette can be tweaked in one place.
 */

import chalk from "chalk";

// ── Accent colours ────────────────────────────────────────────────────────────

/** Vivid cornflower blue — banner art, command examples, section headers. */
export const accent = chalk.hex("#50ACFF");

/** Bold variant for section headings (e.g. "Usage:", "Quick Guide"). */
export const accentBold = chalk.bold.hex("#50ACFF");

/** Honey gold — command names and key metadata. */
export const highlight = chalk.hex("#FFBF33");

/** Soft lemon — warnings, hints, and cautionary help text. */
export const notice = chalk.hex("#FFF05A");

/** Fresh mint — success messages and approved/spendable states. */
export const successTone = chalk.hex("#7CF29A");

/** Warm coral-red — errors and declined states. */
export const dangerTone = chalk.hex("#FF8A80");

/** Soft coral — arguments and parameter names in help text. */
export const subtle = chalk.hex("#E56B8E");

/** Ora spinner colour name closest to the accent (used by ora's `color` opt). */
export const spinnerColor = "blue" as const;
