import chalk from "chalk";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { getConfigDir, ensureConfigDir } from "../services/config.js";

const BANNER_MARKER = ".banner-shown";

function bannerMarkerPath(): string {
  return join(getConfigDir(), BANNER_MARKER);
}

function hasBannerBeenShown(): boolean {
  return existsSync(bannerMarkerPath());
}

function markBannerShown(): void {
  try {
    ensureConfigDir();
    writeFileSync(bannerMarkerPath(), "", { mode: 0o600 });
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
  // Only show the banner once (first run)
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
