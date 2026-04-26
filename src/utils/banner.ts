import chalk from "chalk";
import { accent, brand, muted } from "./theme.js";
import { renderKoiPond, KOI_POND_WIDTH, KOI_POND_HEIGHT } from "./koi-pond.js";
import {
  renderMerkleTree,
  MERKLE_TREE_WIDTH,
  MERKLE_TREE_HEIGHT,
} from "./merkle-tree.js";
import { getTerminalColumns, visibleWidth, padDisplay, inlineSeparator } from "./terminal.js";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  DEFAULT_WELCOME_BANNER_ACTIONS,
  type WelcomeAction,
} from "./welcome-readiness.js";

// ── Session marker ─────────────────────────────────────────────────────────

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function getSessionIdentifier(): string | null {
  // Fast path: env vars set by most terminal emulators (zero overhead)
  const envSession =
    process.env.TERM_SESSION_ID ||
    process.env.ITERM_SESSION_ID ||
    process.env.WT_SESSION ||
    process.env.TMUX ||
    process.env.STY ||
    process.env.SSH_TTY;

  if (envSession && envSession.trim().length > 0) {
    return envSession.trim();
  }

  // Fast fallback: ppid is always available and stable within a shell session.
  // Prefer this over spawning child processes (tty/ps) which add ~10-30ms each.
  if (process.ppid > 1) {
    return `ppid-${process.ppid}`;
  }

  return null;
}

type BannerArt = "koi" | "merkle";

function bannerMarkerVersionSuffix(version: string | undefined): string {
  const trimmed = version?.trim();
  const normalized = trimmed && trimmed.length > 0
    ? trimmed.replace(/^v/i, "")
    : "unknown";
  return sanitizeForFilename(`v${normalized}`);
}

function bannerMarkerPath(version: string | undefined): string {
  const sessionId = getSessionIdentifier();
  const versionSuffix = bannerMarkerVersionSuffix(version);
  if (sessionId) {
    return join(
      tmpdir(),
      `privacy-pools-banner-${sanitizeForFilename(sessionId)}-${versionSuffix}.shown`
    );
  }
  // Worst-case fallback if session detection fails.
  return join(tmpdir(), `privacy-pools-banner-fallback-${versionSuffix}.shown`);
}

function hasBannerBeenShown(version: string | undefined): boolean {
  return existsSync(bannerMarkerPath(version));
}

function markBannerShown(version: string | undefined): void {
  const markerPath = bannerMarkerPath(version);
  try {
    writeFileSync(markerPath, "", { mode: 0o600 });
  } catch {
    // Best effort - don't break the CLI over a marker file
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface BannerMeta {
  version?: string;
  repository?: string | null;
  website?: string;
  readinessLabel?: string;
  bannerHint?: string;
  actions?: readonly WelcomeAction[];
}

function formatBannerActionLines(actions: readonly WelcomeAction[]): string[] {
  const renderedCommands = actions.map(
    (action) => `privacy-pools ${action.cliCommand}`,
  );
  const commandWidth =
    Math.max(...renderedCommands.map((command) => command.length), 0) + 2;

  return actions.map((action, index) =>
    `${accent(renderedCommands[index].padEnd(commandWidth))}${muted(action.description)}`,
  );
}

function composeWelcomeText(meta: BannerMeta): string[] {
  const version = meta.version?.trim();
  const website = meta.website?.trim() || "privacypools.com";
  const sep = inlineSeparator();

  const versionLine = version
    ? `${muted(`v${version}`)}${muted(sep)}${accent(website)}${meta.readinessLabel ? `${muted(sep)}${muted(meta.readinessLabel)}` : ""}`
    : accent(website);
  const actionLines = formatBannerActionLines(
    meta.actions ?? DEFAULT_WELCOME_BANNER_ACTIONS,
  );

  return [
    brand("PRIVACY POOLS"),
    muted("A compliant way to transact privately on Ethereum."),
    versionLine,
    ...(meta.bannerHint ? [muted(meta.bannerHint)] : []),
    "",
    ...actionLines,
  ];
}

function composeSideBySide(
  artLines: string[],
  textLines: string[],
  gap: number,
): string[] {
  const poolHeight = artLines.length;
  const textHeight = textLines.length;
  const totalHeight = Math.max(poolHeight, textHeight);
  const textOffset = Math.floor((poolHeight - textHeight) / 2);

  // Determine the maximum visible width across all art lines for consistent padding
  let maxPoolWidth = 0;
  for (const line of artLines) {
    const w = visibleWidth(line);
    if (w > maxPoolWidth) maxPoolWidth = w;
  }

  const result: string[] = [];
  for (let i = 0; i < totalHeight; i++) {
    const poolPart = i < poolHeight ? padDisplay(artLines[i], maxPoolWidth) : " ".repeat(maxPoolWidth);
    const textIdx = i - textOffset;
    const textPart = textIdx >= 0 && textIdx < textHeight ? textLines[textIdx] : "";
    result.push(poolPart + " ".repeat(gap) + textPart);
  }

  return result;
}

// ── Main banner ─────────────────────────────────────────────────────────────

/** Widest visible line of the welcome text block. */
function welcomeTextWidth(lines: readonly string[]): number {
  let max = 0;
  for (const line of lines) {
    const w = visibleWidth(line);
    if (w > max) max = w;
  }
  return max;
}

const SIDE_BY_SIDE_GAP = 3;
/** Minimum terminal rows required for compact mode (pool above text). */
const COMPACT_MIN_ROWS_HEADROOM = 2;

type BannerMode = "narrow" | "compact" | "side";

interface BannerLayout {
  mode: BannerMode;
  columns: number;
  rows: number | null;
  art: BannerArt;
}

function getTerminalRows(): number | null {
  const r =
    (process.stderr as { rows?: number }).rows ??
    (process.stdout as { rows?: number }).rows;
  return typeof r === "number" && r > 0 ? r : null;
}

function resolveBannerArt(env: NodeJS.ProcessEnv = process.env): BannerArt {
  const raw = (
    env.PRIVACY_POOLS_BANNER_ART ??
    env.PRIVACY_POOLS_BANNER
  )?.trim().toLowerCase();
  if (raw === "merkle" || raw === "tree" || raw === "proof") {
    return "merkle";
  }
  return "koi";
}

function bannerArtSize(art: BannerArt): { width: number; height: number } {
  return art === "merkle"
    ? { width: MERKLE_TREE_WIDTH, height: MERKLE_TREE_HEIGHT }
    : { width: KOI_POND_WIDTH, height: KOI_POND_HEIGHT };
}

function renderBannerArt(art: BannerArt, useColor: boolean): string[] {
  return art === "merkle"
    ? renderMerkleTree({ useColor })
    : renderKoiPond({ useColor });
}

/**
 * Decide which layout to render for the current terminal size.
 * Three modes:
 *   - `narrow`: text-only (terminal too narrow for the illustration)
 *   - `compact`: koi pond centered above text
 *   - `side`: koi pond left of text
 */
function computeBannerLayout(welcomeText: readonly string[]): BannerLayout {
  const columns = getTerminalColumns();
  const rows = getTerminalRows();
  const textWidth = welcomeTextWidth(welcomeText);
  const textHeight = welcomeText.length;
  const art = resolveBannerArt();
  const artSize = bannerArtSize(art);

  // Below this width, the welcome text itself starts to feel cramped and
  // adding any illustration makes it worse. Drop to text-only fallback.
  if (columns < 72) {
    return { mode: "narrow", columns, rows, art };
  }

  // Side-by-side requires: pool + gap + text block + small margin.
  if (columns - textWidth - SIDE_BY_SIDE_GAP >= artSize.width) {
    return { mode: "side", columns, rows, art };
  }

  // Compact (pool above text) requires room for pool + text block vertically.
  const canFitVertically =
    rows === null || rows >= artSize.height + textHeight + COMPACT_MIN_ROWS_HEADROOM;
  if (canFitVertically) {
    return { mode: "compact", columns, rows, art };
  }

  // Not enough vertical room for pool + text.
  return { mode: "narrow", columns, rows, art };
}

/**
 * Render one full banner frame as an array of lines (no trailing newlines).
 */
function composeBannerFrame(
  layout: BannerLayout,
  welcomeText: readonly string[],
  useColor: boolean,
): string[] {
  if (layout.mode === "narrow") {
    // welcomeText already begins with wordmark + tagline + version.
    return [...welcomeText];
  }

  const artFrame = renderBannerArt(layout.art, useColor);
  const artWidth = bannerArtSize(layout.art).width;

  if (layout.mode === "side") {
    return composeSideBySide(artFrame, [...welcomeText], SIDE_BY_SIDE_GAP);
  }

  // Compact: center the pond horizontally above the text block.
  const poolLeftPad = Math.max(0, Math.floor((layout.columns - artWidth) / 2));
  const pad = " ".repeat(poolLeftPad);
  const centeredPool = artFrame.map((line) => pad + line);
  return [...centeredPool, "", ...welcomeText];
}

/** Write a welcome frame to stdout, matching built-in help/welcome output. */
function writeBannerFrame(lines: readonly string[]): void {
  for (const line of lines) {
    process.stdout.write(line + "\n");
  }
}

// ── Public entry point ──────────────────────────────────────────────────

export async function printBanner(
  meta: BannerMeta = {},
): Promise<{ includedWelcomeText: boolean }> {
  // Only show once per terminal session.
  if (hasBannerBeenShown(meta.version)) return { includedWelcomeText: false };

  const useColor = chalk.level > 0;
  const welcomeText = composeWelcomeText(meta);
  const layout = computeBannerLayout(welcomeText);

  // Narrow: no room for the illustration. Let the caller render the
  // welcome screen on its own (wordmark + tagline + version + actions) —
  // we'd otherwise double-print the wordmark and tagline.
  if (layout.mode === "narrow") {
    markBannerShown(meta.version);
    return { includedWelcomeText: false };
  }

  // Render the static illustration. `computeBannerLayout` already
  // picks side-by-side when there's room for the art beside the
  // text block; otherwise it falls back to the compact pool-above-text
  // layout. No animation, no cursor games, no resize listener.
  const frame = composeBannerFrame(layout, welcomeText, useColor);
  writeBannerFrame(frame);
  process.stdout.write("\n");
  markBannerShown(meta.version);
  return { includedWelcomeText: true };
}
