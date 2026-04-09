import chalk from "chalk";
import { accent, brand } from "./theme.js";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getTerminalColumns } from "./terminal.js";

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

const LOGO_LINES = [
  ",---. ,---. ,-.-.   .-.--.   ,--.-.   .-.   ,---.  .---.  .---. ,-.     .---.",
  "| .-.\\| .-.\\|(|\\ \\ / / /\\ \\.' .')\\ \\_/ )/   | .-.\\/ .-. )/ .-. )| |    ( .-._)",
  "| |-' | `-'/(_) \\ V / /__\\ |  |(_)\\   (_)   | |-' | | |(_| | |(_| |   (_) \\",
  "| |--'|   ( | |  ) /|  __  \\  \\    ) (      | |--'| | | || | | || |   _  \\ \\",
  "| |   | |\\ \\| | (_) | |  |)|\\  `-. | |      | |   \\ `-' /\\ `-' /| `--( `-'  )",
  "/(    |_| \\)`-'     |_|  (_) \\____/(_|      /(     )---'  )---' |( __.`----'",
  "(__)       (__)                   (__)      (__)   (_)    (_)    (_)",
];

const TAGLINE = "A compliant way to transact privately on Ethereum.";
const WORDMARK = "Privacy Pools";

const DEFAULT_WEBSITE = "privacypools.com";

const FRAME_DELAY = 65;

interface BannerMeta {
  version?: string;
  repository?: string | null;
  website?: string;
}

interface BannerLine {
  plain: string;
  styled: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMetaLines(meta: BannerMeta): BannerLine[] {
  const contentWidth = Math.max(40, getTerminalColumns() - 2);
  const version = meta.version?.trim();
  const website = meta.website?.trim() || DEFAULT_WEBSITE;
  const repository = meta.repository?.trim();
  const compactMeta = {
    plain: version
      ? repository
        ? `v${version} | ${website} | ${repository}`
        : `v${version} | ${website}`
      : repository
        ? `${website} | ${repository}`
        : website,
    styled: version
      ? repository
        ? `${accent(`v${version}`)}${chalk.dim(" | ")}${accent(website)}${chalk.dim(" | ")}${accent(repository)}`
        : `${accent(`v${version}`)}${chalk.dim(" | ")}${accent(website)}`
      : repository
        ? `${accent(website)}${chalk.dim(" | ")}${accent(repository)}`
        : accent(website),
  };

  if (compactMeta.plain.length <= contentWidth) {
    return [compactMeta];
  }

  const lines: BannerLine[] = [
    {
      plain: version ? `v${version} | ${website}` : website,
      styled: version
        ? `${accent(`v${version}`)}${chalk.dim(" | ")}${accent(website)}`
        : accent(website),
    },
  ];

  if (repository) {
    lines.push({
      plain: repository,
      styled: accent(repository),
    });
  }

  return lines;
}

function composeBannerLines(meta: BannerMeta): string[] {
  const metaLines = buildMetaLines(meta);
  const columns = getTerminalColumns();

  if (columns < 72) {
    return [
      brand(WORDMARK),
      `  ${chalk.dim(TAGLINE)}`,
      ...metaLines.map((line) => `  ${line.styled}`),
    ];
  }

  if (columns < 96) {
    return [
      brand("PRIVACY POOLS"),
      `  ${chalk.dim(TAGLINE)}`,
      ...metaLines.map((line) => `  ${line.styled}`),
    ];
  }

  return [
    ...LOGO_LINES.map((line) => brand(line)),
    "",
    `  ${chalk.dim(TAGLINE)}`,
    ...metaLines.map((line) => `  ${line.styled}`),
  ];
}

export async function printBanner(meta: BannerMeta = {}): Promise<void> {
  // Only show once per terminal session.
  if (hasBannerBeenShown()) return;

  const lines = composeBannerLines(meta);

  // Skip animation if output is not a TTY (piped, CI, etc.)
  if (!process.stderr.isTTY) {
    for (const line of lines) {
      process.stderr.write(line + "\n");
    }
    process.stderr.write("\n");
    markBannerShown();
    return;
  }

  // Animate line-by-line
  for (const line of lines) {
    process.stderr.write(line + "\n");
    await sleep(FRAME_DELAY);
  }

  // Pause to let the banner breathe before the rest of the output
  await sleep(180);
  process.stderr.write("\n");
  markBannerShown();
}
