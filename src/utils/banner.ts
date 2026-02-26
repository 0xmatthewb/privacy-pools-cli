import chalk from "chalk";
import { spawnSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function getSessionIdentifier(): string | null {
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

  if (process.stderr.isTTY) {
    const tty = spawnSync("tty", [], { encoding: "utf8" });
    if (tty.status === 0) {
      const ttyPath = tty.stdout.trim();
      if (ttyPath && ttyPath !== "not a tty") {
        return `tty-${ttyPath}`;
      }
    }
  }

  // POSIX session id fallback (macOS/Linux): stable across commands in the same terminal session.
  for (const field of ["sid=", "sess="]) {
    const ps = spawnSync("ps", ["-o", field, "-p", String(process.pid)], {
      encoding: "utf8",
    });
    if (ps.status === 0) {
      const session = ps.stdout.trim();
      if (/^\d+$/.test(session)) {
        return `sid-${session}`;
      }
    }
  }

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
  " ,---.  ,---.  ,-..-.   .-..--.    ,--,.-.   .-.",
  " | .-.\\ | .-.\\ |(| \\ \\ / // /\\ \\ .' .') \\ \\_/ )/",
  " | |-' )| `-'/ (_)  \\ V // /__\\ \\|  |(_) \\   (_)",
  " | |--' |   (  | |   ) / |  __  |\\  \\     ) (   ",
  " | |    | |\\ \\ | |  (_)  | |  |)| \\  `-.  | |   ",
  " /(     |_| \\)`-'       |_|  (_)  \\____\\/(_|   ",
  "(__)        (__)                        (__)    ",
  " ,---.   .---.   .---.  ,-.      .---.          ",
  " | .-.\\ / .-. ) / .-. ) | |     ( .-._)         ",
  " | |-' )| | |(_)| | |(_)| |    (_) \\            ",
  " | |--' | | | | | | | | | |    _  \\ \\           ",
  " | |    \\ `-' / \\ `-' / | `--.( `-'  )          ",
  " /(      )---'   )---'  |( __.'`----'           ",
  "(__)    (_)     (_)     (_)                     ",
];

const FRAME_DELAY = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function printBanner(): Promise<void> {
  // Only show once per terminal session.
  if (hasBannerBeenShown()) return;

  // Skip animation if output is not a TTY (piped, CI, etc.)
  if (!process.stderr.isTTY) {
    for (const line of LOGO_LINES) {
      process.stderr.write(chalk.cyan(line) + "\n");
    }
    process.stderr.write("\n");
    markBannerShown();
    return;
  }

  // Animate line-by-line
  for (const line of LOGO_LINES) {
    process.stderr.write(chalk.cyan(line) + "\n");
    await sleep(FRAME_DELAY);
  }

  // Pause to let the banner breathe before the rest of the output
  await sleep(500);
  process.stderr.write("\n");
  markBannerShown();
}
