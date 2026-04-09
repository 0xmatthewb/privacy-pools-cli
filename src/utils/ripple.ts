/**
 * Computed ASCII ripple pool renderer.
 *
 * Pure computation module: given dimensions and a time step, returns an
 * array of styled strings representing one frame of concentric water
 * ripples radiating from an amber center to blue edges.
 *
 * Used by the banner module for the animated welcome screen.
 */

import chalk from "chalk";

// ── Density ramps ────────────────────────────────────────────────────────────

/** Sparse-to-dense character ramp for Unicode terminals. */
export const UNICODE_DENSITY = " .\u00b7:;=+*#%@";

/** ASCII-safe equivalent (replaces middle dot with comma). */
export const ASCII_DENSITY = " .,:-=+*#%@";

// ── Animation constants ─────────────────────────────────────────────────────

/** Number of frames in one ripple animation cycle. */
export const RIPPLE_FRAME_COUNT = 19;

/** Milliseconds per frame (~12.5 fps). */
export const RIPPLE_FRAME_DELAY_MS = 80;

// ── Color palette (pre-computed zones for ANSI efficiency) ──────────────────

const BRAND_HEX = "#D4A030";
const ACCENT_HEX = "#5AADD6";
const TRANSITION_HEX = "#8EA87A";
const DIM_HEX = "#4A7E9B";

const colorBrand = chalk.hex(BRAND_HEX);
const colorTransition = chalk.hex(TRANSITION_HEX);
const colorAccent = chalk.hex(ACCENT_HEX);
const colorDim = chalk.hex(DIM_HEX);
const colorEdge = chalk.dim;

// ── Frame rendering ─────────────────────────────────────────────────────────

/**
 * Character aspect ratio correction.  Terminal characters are roughly
 * twice as tall as they are wide, so we compress the vertical axis to
 * make the elliptical pool appear circular.
 */
const ASPECT_Y = 0.48;

function applyZoneColor(ch: string, dist: number): string {
  if (dist < 0.25) return colorBrand(ch);
  if (dist < 0.38) return colorTransition(ch);
  if (dist < 0.65) return colorAccent(ch);
  if (dist < 0.80) return colorDim(ch);
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
 * @returns Array of strings, one per line (no trailing newline)
 */
export function renderRippleFrame(
  width: number,
  height: number,
  timeStep: number,
  options: { useColor: boolean; useUnicode: boolean },
): string[] {
  const ramp = options.useUnicode ? UNICODE_DENSITY : ASCII_DENSITY;
  const cx = width / 2;
  const cy = height / 2;
  const lines: string[] = [];

  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx;
      const dy = ((y - cy) / cy) / ASPECT_Y;
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
