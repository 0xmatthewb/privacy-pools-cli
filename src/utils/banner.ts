import chalk from "chalk";
import { accent, brand } from "./theme.js";
import { renderRippleFrame, RIPPLE_FRAME_COUNT, RIPPLE_FRAME_DELAY_MS } from "./ripple.js";
import { getTerminalColumns, supportsUnicodeOutput, visibleWidth, padDisplay, inlineSeparator } from "./terminal.js";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  DEFAULT_WELCOME_BANNER_ACTIONS,
  type WelcomeAction,
} from "./welcome-readiness.js";

// ── Session marker (unchanged) ─────────────────────────────────────────────

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

function bannerMarkerPath(): string {
  const sessionId = getSessionIdentifier();
  if (sessionId) {
    return join(
      tmpdir(),
      `privacy-pools-banner-${sanitizeForFilename(sessionId)}.shown`
    );
  }
  // Worst-case fallback if session detection fails.
  return join(tmpdir(), "privacy-pools-banner-fallback.shown");
}

function hasBannerBeenShown(): boolean {
  return existsSync(bannerMarkerPath());
}

function markBannerShown(): void {
  const markerPath = bannerMarkerPath();
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
  actions?: readonly WelcomeAction[];
}

function defaultBannerSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let bannerSleepFn = defaultBannerSleep;

export function overrideBannerSleepForTests(
  sleepFn?: (ms: number) => Promise<void>,
): void {
  bannerSleepFn = sleepFn ?? defaultBannerSleep;
}

function formatBannerActionLines(actions: readonly WelcomeAction[]): string[] {
  const renderedCommands = actions.map(
    (action) => `privacy-pools ${action.cliCommand}`,
  );
  const commandWidth =
    Math.max(...renderedCommands.map((command) => command.length), 0) + 2;

  return actions.map((action, index) =>
    `${accent(renderedCommands[index].padEnd(commandWidth))}${chalk.dim(action.description)}`,
  );
}

function composeWelcomeText(meta: BannerMeta): string[] {
  const version = meta.version?.trim();
  const website = meta.website?.trim() || "privacypools.com";
  const sep = inlineSeparator();

  const versionLine = version
    ? `${chalk.dim(`v${version}`)}${chalk.dim(sep)}${accent(website)}${meta.readinessLabel ? `${chalk.dim(sep)}${chalk.dim(meta.readinessLabel)}` : ""}`
    : accent(website);
  const actionLines = formatBannerActionLines(
    meta.actions ?? DEFAULT_WELCOME_BANNER_ACTIONS,
  );

  return [
    brand("PRIVACY POOLS"),
    chalk.dim("A compliant way to transact privately on Ethereum."),
    versionLine,
    "",
    ...actionLines,
  ];
}

function composeSideBySide(
  poolLines: string[],
  textLines: string[],
  gap: number,
): string[] {
  const poolHeight = poolLines.length;
  const textHeight = textLines.length;
  const totalHeight = Math.max(poolHeight, textHeight);
  const textOffset = Math.floor((poolHeight - textHeight) / 2);

  // Determine the maximum visible width across all pool lines for consistent padding
  let maxPoolWidth = 0;
  for (const line of poolLines) {
    const w = visibleWidth(line);
    if (w > maxPoolWidth) maxPoolWidth = w;
  }

  const result: string[] = [];
  for (let i = 0; i < totalHeight; i++) {
    const poolPart = i < poolHeight ? padDisplay(poolLines[i], maxPoolWidth) : " ".repeat(maxPoolWidth);
    const textIdx = i - textOffset;
    const textPart = textIdx >= 0 && textIdx < textHeight ? textLines[textIdx] : "";
    result.push(poolPart + " ".repeat(gap) + textPart);
  }

  return result;
}

// ── Main banner ─────────────────────────────────────────────────────────────

export async function printBanner(
  meta: BannerMeta = {},
): Promise<{ includedWelcomeText: boolean }> {
  // Only show once per terminal session.
  if (hasBannerBeenShown()) return { includedWelcomeText: false };

  const columns = getTerminalColumns();
  const useColor = chalk.level > 0;
  const useUnicode = supportsUnicodeOutput();

  // ── Narrow (< 72 columns) ──────────────────────────────────────────────
  if (columns < 72) {
    process.stderr.write(brand("PRIVACY POOLS") + "\n");
    process.stderr.write(chalk.dim("A compliant way to transact privately on Ethereum.") + "\n");
    process.stderr.write("\n");
    markBannerShown();
    return { includedWelcomeText: false };
  }

  const welcomeText = composeWelcomeText(meta);

  // ── Non-TTY (piped, CI, etc.) ─────────────────────────────────────────
  if (!process.stderr.isTTY) {
    const poolWidth = columns >= 96 ? 62 : 40;
    const poolHeight = columns >= 96 ? 22 : 14;
    const frame = renderRippleFrame(poolWidth, poolHeight, 10, { useColor, useUnicode });

    let output: string[];
    if (columns >= 96) {
      output = composeSideBySide(frame, welcomeText, 3);
    } else {
      output = [...frame, "", ...welcomeText];
    }

    for (const line of output) {
      process.stderr.write(line + "\n");
    }
    process.stderr.write("\n");
    markBannerShown();
    return { includedWelcomeText: true };
  }

  // ── Wide TTY (>= 96 columns): side-by-side animation ─────────────────
  if (columns >= 96) {
    const poolWidth = 62;
    const poolHeight = 22;

    // First frame
    const firstFrame = renderRippleFrame(poolWidth, poolHeight, 0, { useColor, useUnicode });
    const firstComposed = composeSideBySide(firstFrame, welcomeText, 3);
    const lineCount = firstComposed.length;

    for (const line of firstComposed) {
      process.stderr.write(line + "\n");
    }

    // Animate frames 1..18
    for (let t = 1; t < RIPPLE_FRAME_COUNT; t++) {
      await bannerSleepFn(RIPPLE_FRAME_DELAY_MS);
      process.stderr.write(`\x1b[${lineCount}A`);
      const frame = renderRippleFrame(poolWidth, poolHeight, t, { useColor, useUnicode });
      const composed = composeSideBySide(frame, welcomeText, 3);
      for (const line of composed) {
        process.stderr.write(line + "\n");
      }
    }

    // Breathing pause
    await bannerSleepFn(180);
    markBannerShown();
    return { includedWelcomeText: true };
  }

  // ── Compact TTY (72 <= columns < 96): pool above text ─────────────────
  const poolWidth = 40;
  const poolHeight = 14;

  // First frame (pool only, text is static below)
  const firstFrame = renderRippleFrame(poolWidth, poolHeight, 0, { useColor, useUnicode });
  for (const line of firstFrame) {
    process.stderr.write(line + "\n");
  }
  // Static text below pool
  process.stderr.write("\n");
  for (const line of welcomeText) {
    process.stderr.write(line + "\n");
  }

  // Animate frames 1..18 (cursor-up only covers pool lines)
  const poolLineCount = poolHeight;
  const textBlockHeight = 1 + welcomeText.length; // blank line + text lines
  const totalUp = poolLineCount + textBlockHeight;

  for (let t = 1; t < RIPPLE_FRAME_COUNT; t++) {
    await bannerSleepFn(RIPPLE_FRAME_DELAY_MS);
    // Move cursor up past text and pool
    process.stderr.write(`\x1b[${totalUp}A`);
    const frame = renderRippleFrame(poolWidth, poolHeight, t, { useColor, useUnicode });
    for (const line of frame) {
      process.stderr.write(line + "\n");
    }
    // Move cursor down past static text
    process.stderr.write(`\x1b[${textBlockHeight}B`);
  }

  // Breathing pause
  await bannerSleepFn(180);
  markBannerShown();
  return { includedWelcomeText: true };
}
