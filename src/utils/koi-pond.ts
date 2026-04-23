/**
 * Static koi pond ASCII illustration for the welcome banner.
 *
 * Compact framed design (20 cols × 8 rows):
 *   - Rounded box border
 *   - Water surface shimmer (~─~) on top + bottom rows
 *   - Lotus flower (*) + lily pad (oo) in green tones
 *   - Two koi fish (><((°>, <°))><) in gold tones
 *   - Scattered bubbles and ripples in blue tones
 *
 * Character width notes: all characters used are single-width (ASCII or
 * narrow Unicode box-drawing) so row widths are deterministic across
 * terminals. Previous variants used ✿ / ◯ which rendered as display-
 * width 2 in some terminals and broke the right-border alignment; those
 * have been replaced with `*` and `oo` respectively.
 */

import chalk from "chalk";

// ── Palette ────────────────────────────────────────────────────────────

const WATER_LIGHT = "#8FCDE8";
const WATER_MID = "#5AADD6";
const WATER_DEEP = "#4594C2";
const POOL_WALL = "#5AADD6";
const KOI_BRIGHT = "#E8BF4A";
const KOI_MAIN = "#D4A030";
const KOI_DEEP = "#9A6820";
const LILY_PAD = "#6D8E5A";
const LILY_PAD_DARK = "#4F6B44";
const FLOWER = "#E88F6A";

/** Visible pool width (single-width chars only; matches the border row). */
export const KOI_POND_WIDTH = 20;
/** Total pool height in rows. */
export const KOI_POND_HEIGHT = 8;

function paintWater(run: string, useColor: boolean): string {
  if (!useColor) return run;
  const waterL = chalk.hex(WATER_LIGHT);
  const waterM = chalk.hex(WATER_MID);
  const waterD = chalk.hex(WATER_DEEP);
  let out = "";
  for (const ch of run) {
    if (ch === "~") out += waterM(ch);
    else if (ch === "^") out += waterL(ch);
    else if (ch === "_" || ch === "-") out += waterD(ch);
    else out += ch;
  }
  return out;
}

/**
 * Render the compact koi pond illustration. Returns 8 lines of exactly
 * 20 visible columns (borders + content).
 */
export function renderKoiPond(options: { useColor: boolean }): string[] {
  const { useColor } = options;
  const id = (s: string) => s;
  const wall = useColor ? chalk.hex(POOL_WALL) : id;
  const acL = useColor ? chalk.hex(WATER_LIGHT) : id;
  const mid = useColor ? chalk.hex(WATER_MID) : id;
  const deep = useColor ? chalk.hex(WATER_DEEP) : id;
  const koiBright = useColor ? chalk.hex(KOI_BRIGHT) : id;
  const koiMain = useColor ? chalk.hex(KOI_MAIN) : id;
  const koiDeep = useColor ? chalk.hex(KOI_DEEP) : id;
  const lily = useColor ? chalk.hex(LILY_PAD) : id;
  const lilyDark = useColor ? chalk.hex(LILY_PAD_DARK) : id;
  const flower = useColor ? chalk.hex(FLOWER) : id;
  const paint = (s: string) => paintWater(s, useColor);

  // Row-by-row layout — every row is exactly 20 visible chars (border +
  // 18 interior + border). Trailing whitespace is zero.
  return [
    wall("╭──────────────────╮"),
    wall("│") + paint(" ~─~─~─~─~─~─~─~  ") + wall("│"),
    wall("│") +
      "   " +
      flower("*") +
      "   " +
      koiBright("><") +
      koiMain("((") +
      koiDeep("°") +
      koiBright(">") +
      "     " +
      wall("│"),
    wall("│") + "  " + lily("o") + lilyDark("o") + "       " + mid("·") + "      " + wall("│"),
    wall("│") + "     " + mid("~") + "    " + deep("≈") + "       " + wall("│"),
    wall("│") +
      "  " +
      mid("·") +
      "    " +
      koiBright("<") +
      koiDeep("°") +
      koiMain("))") +
      koiBright("><") +
      "     " +
      wall("│"),
    wall("│") + paint(" ~─~─~─~─~─~─~─~  ") + wall("│"),
    wall("╰──────────────────╯"),
  ];
}
