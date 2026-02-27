import chalk from "chalk";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
function sanitizeForFilename(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
function getSessionIdentifier() {
    // Fast path: env vars set by most terminal emulators (zero overhead)
    const envSession = process.env.TERM_SESSION_ID ||
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
function bannerMarkerPath() {
    const sessionId = getSessionIdentifier();
    if (sessionId) {
        return join(tmpdir(), `privacy-pools-banner-${sanitizeForFilename(sessionId)}.shown`);
    }
    // Worst-case fallback if session detection fails.
    return join(tmpdir(), "privacy-pools-banner-fallback.shown");
}
function hasBannerBeenShown() {
    return existsSync(bannerMarkerPath());
}
function markBannerShown() {
    const markerPath = bannerMarkerPath();
    try {
        writeFileSync(markerPath, "", { mode: 0o600 });
    }
    catch {
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
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function printBanner() {
    // Only show once per terminal session.
    if (hasBannerBeenShown())
        return;
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
