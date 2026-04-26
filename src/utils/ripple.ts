/**
 * Computed ASCII ripple pool renderer.
 *
 * Pure computation module: given dimensions and a time step, returns an
 * array of styled strings representing one frame of concentric water
 * ripples radiating from an amber center to blue edges.
 *
 * Preserved for future TUI surfaces.
 */

import chalk from "chalk";
import { faint } from "./theme.js";

// ── Density ramps ────────────────────────────────────────────────────────────

/** Sparse-to-dense character ramp for Unicode terminals. */
export const UNICODE_DENSITY = " .\u00b7:;=+*#%@";

/** ASCII-safe equivalent (replaces middle dot with comma). */
export const ASCII_DENSITY = " .,:-=+*#%@";

// ── Animation constants ─────────────────────────────────────────────────────

/**
 * Number of frames the welcome banner animates through.
 * 40 frames × RIPPLE_FRAME_DELAY_MS ≈ 2.2s — long enough for the motion
 * to register as "water rippling," short enough to not overstay.
 */
export const RIPPLE_FRAME_COUNT = 40;

/** Milliseconds per frame (~18 fps). Tuned for motion that reads as water. */
export const RIPPLE_FRAME_DELAY_MS = 55;

// ── Color palette (pre-computed zones for ANSI efficiency) ──────────────────
//
// Design: water-dominant pool with a small warm center accent.
// Blue shades carry ~85% of the pool's visible area; the gold core is a
// small highlight (think "sun glint on water") rather than a dominant
// color band. Concentric zones from center outward:
//
//   1. tiny gold core           — warm accent, maybe 2-4 chars wide
//   2. bright water (accent)    — primary brand blue
//   3. mid water                — slightly deeper blue for depth
//   4. dim water                — outer cool-blue falloff
//   5. edge fade                — theme faint so the pool edges bleed into bg

const BRAND_HEX = "#D4A030";   // gold — small center accent only
const ACCENT_HEX = "#5AADD6";  // bright water (primary brand blue)
const MID_HEX = "#4594C2";     // mid water — slightly deeper than accent
const DIM_HEX = "#4A7E9B";     // dim water — outer falloff

const colorBrand = chalk.hex(BRAND_HEX);
const colorAccent = chalk.hex(ACCENT_HEX);
const colorMid = chalk.hex(MID_HEX);
const colorDim = chalk.hex(DIM_HEX);
const colorEdge = faint;

// ── Frame rendering ─────────────────────────────────────────────────────────

/**
 * Character aspect ratio correction.  Terminal characters are roughly
 * twice as tall as they are wide, so we compress the vertical axis to
 * make the elliptical pool appear circular.
 */
const ASPECT_Y = 0.48;

function applyZoneColor(ch: string, dist: number): string {
  // Gold covers ~2.25% of the disk (r < 0.15 → π·r² ≈ 0.07 of full area);
  // visible warm center, but the rest of the pool reads clearly as water.
  if (dist < 0.15) return colorBrand(ch);
  if (dist < 0.40) return colorAccent(ch);
  if (dist < 0.68) return colorMid(ch);
  if (dist < 0.88) return colorDim(ch);
  return colorEdge(ch);
}

/**
 * Render a single frame of the ripple pool animation.
 *
 * @param width   Characters per line
 * @param height  Number of lines
 * @param timeStep  Animation time (0..RIPPLE_FRAME_COUNT-1)
 * @param options.useColor  Apply ANSI color codes
 * @param options.useUnicode  Use Unicode density characters
 * @param options.aspectY    Override vertical aspect. Default (ASPECT_Y) keeps
 *                           the ellipse visually circular; pass a larger value
 *                           (e.g. 1.0) to fill a wide rectangle with an oval.
 * @returns Array of strings, one per line (no trailing newline)
 */
export function renderRippleFrame(
  width: number,
  height: number,
  timeStep: number,
  options: { useColor: boolean; useUnicode: boolean; aspectY?: number },
): string[] {
  const ramp = options.useUnicode ? UNICODE_DENSITY : ASCII_DENSITY;
  const cx = width / 2;
  const cy = height / 2;
  const aspectY = options.aspectY ?? ASPECT_Y;
  const lines: string[] = [];

  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx;
      const dy = ((y - cy) / cy) / aspectY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Outside the elliptical boundary
      if (dist > 1.05) {
        line += " ";
        continue;
      }

      // Smooth edge fade
      const edgeFade =
        dist > 0.88 ? Math.max(0, 1 - (dist - 0.88) / 0.17) : 1;

      // Three overlapping sine waves at different frequencies
      const w1 = Math.sin(dist * 10 - timeStep * 0.05) * 0.5 + 0.5;
      const w2 = Math.sin(dist * 6.5 - timeStep * 0.032 + 1.0) * 0.35 + 0.5;
      const w3 = Math.sin(dist * 16 - timeStep * 0.068 + 2.5) * 0.15 + 0.5;

      // Depth glow: center brighter, edges dimmer
      const depthGlow = Math.pow(Math.max(0, 1 - dist * 0.75), 0.5);

      // Combine waves with depth and edge
      const raw = (w1 * 0.5 + w2 * 0.3 + w3 * 0.2) * depthGlow * edgeFade;
      const intensity = Math.min(1, raw * 1.3 + 0.08 * edgeFade * depthGlow);

      // Map to density character
      const ci = Math.min(
        ramp.length - 1,
        Math.floor(intensity * (ramp.length - 0.01)),
      );
      const ch = ramp[ci];

      if (ch === " " || !options.useColor) {
        line += ch;
      } else {
        line += applyZoneColor(ch, dist);
      }
    }
    lines.push(line);
  }

  return lines;
}
