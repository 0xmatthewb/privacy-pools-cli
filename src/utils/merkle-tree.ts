/**
 * Static Merkle tree ASCII illustration — alternative welcome banner art.
 *
 * Proof-path highlighted (M3 design):
 *   - Root (◉) in bright gold at the top
 *   - Gold path (╱, ●, ╲) from root down through intermediate nodes
 *   - Gold leaf (◉) at the bottom — "your" deposit
 *   - All sibling nodes and off-path branches in dim blue
 *
 * This depicts a ZK inclusion proof: starting from one deposit at the
 * bottom, the gold thread traces upward through the Merkle tree to the
 * root, with sibling hashes (the "witnesses" needed for the proof)
 * shown in dim at each level.
 *
 * Not currently used by the banner (koi pond is the active illustration)
 * — exported for future use as an alternative banner art.
 */

import chalk from "chalk";

// ── Palette ────────────────────────────────────────────────────────────

const GOLD = "#D4A030";
const GOLD_BRIGHT = "#E8BF4A";
const ACCENT = "#5AADD6";
const MID = "#4594C2";
const DIM = "#4A7E9B";

/** Visible tree width (max line width among the 8 rows). */
export const MERKLE_TREE_WIDTH = 16;
/** Total tree height in rows. */
export const MERKLE_TREE_HEIGHT = 8;

/**
 * Render the static Merkle tree with proof-path highlighted in gold.
 * Returns 8 lines centered within a 16-col field.
 */
export function renderMerkleTree(options: { useColor: boolean }): string[] {
  const { useColor } = options;
  const id = (s: string) => s;
  const bB = useColor ? chalk.hex(GOLD_BRIGHT) : id;
  const b = useColor ? chalk.hex(GOLD) : id;
  const ac = useColor ? chalk.hex(ACCENT) : id;
  const mid = useColor ? chalk.hex(MID) : id;
  const dim = useColor ? chalk.hex(DIM) : id;

  // Each row is exactly MERKLE_TREE_WIDTH (16) visible chars. Gold is used
  // for the "your proof path" — root, leftmost branch down to one leaf.
  return [
    "       " + bB("◉") + "        ",
    "      " + b("╱") + " " + dim("╲") + "       ",
    "     " + b("╱") + "   " + dim("╲") + "      ",
    "    " + b("●") + "     " + dim("●") + "     ",
    "   " + dim("╱") + " " + b("╲") + "   " + dim("╱ ╲") + "    ",
    "  " + dim("●") + "   " + b("●") + " " + dim("●") + "   " + dim("●") + "   ",
    " " + dim("╱╲") + "  " + dim("╱") + b("╲") + " " + dim("╱╲") + "  " + dim("╱╲") + "  ",
    dim("●") + " " + dim("●") + " " + dim("●") + " " + bB("◉") + " " + dim("●") + " " + dim("●") + " " + dim("●") + " " + dim("●") + "  ",
  ];
}
