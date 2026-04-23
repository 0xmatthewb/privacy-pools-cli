import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  overrideBannerSleepForTests,
  printBanner,
} from "../../src/utils/banner.ts";
import { captureAsyncOutput } from "../helpers/output.ts";
import { expectSemanticText } from "../helpers/contract-assertions.ts";

const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_COLUMNS = process.env.COLUMNS;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;

function markerPathFor(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return join(tmpdir(), `privacy-pools-banner-${sanitized}.shown`);
}

function setStderrTty(value: boolean): void {
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  if (ORIGINAL_TERM_SESSION_ID === undefined) {
    delete process.env.TERM_SESSION_ID;
  } else {
    process.env.TERM_SESSION_ID = ORIGINAL_TERM_SESSION_ID;
  }
  if (ORIGINAL_COLUMNS === undefined) {
    delete process.env.COLUMNS;
  } else {
    process.env.COLUMNS = ORIGINAL_COLUMNS;
  }
  setStderrTty(Boolean(ORIGINAL_STDERR_IS_TTY));
  overrideBannerSleepForTests();
});

describe("banner render layouts", () => {
  test("narrow tty: banner renders nothing, welcome screen takes over", async () => {
    // Narrow fallback: we intentionally render *no* banner output and return
    // includedWelcomeText=false so the caller's welcomeScreen() prints the
    // wordmark/tagline/version/actions exactly once (no duplication).
    const sessionId = `banner:test/narrow:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId);
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "60";
    setStderrTty(true);
    rmSync(markerPath, { force: true });

    let result: { includedWelcomeText: boolean } | undefined;
    const captured = await captureAsyncOutput(async () => {
      result = await printBanner({ version: "2.0.0" });
    });

    expect(result).toEqual({ includedWelcomeText: false });
    expect(captured.stderr).toBe("");
    expect(existsSync(markerPath)).toBe(true);

    rmSync(markerPath, { force: true });
  });

  test("renders the compact tty layout with welcome text and ripple pool", async () => {
    const sessionId = `banner:test/compact:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId);
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "80";
    setStderrTty(true);
    overrideBannerSleepForTests(async () => {});
    rmSync(markerPath, { force: true });

    let result: { includedWelcomeText: boolean } | undefined;
    const captured = await captureAsyncOutput(async () => {
      result = await printBanner({ version: "2.0.0" });
    });

    expect(result).toEqual({ includedWelcomeText: true });
    expectSemanticText(captured.stderr, {
      includes: ["PRIVACY POOLS", "privacy-pools init", "privacy-pools guide"],
    });
    expect(existsSync(markerPath)).toBe(true);

    rmSync(markerPath, { force: true });
  });

  test("renders the wide tty side-by-side layout and keeps the welcome actions visible", async () => {
    const sessionId = `banner:test/wide:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId);
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "120";
    setStderrTty(true);
    overrideBannerSleepForTests(async () => {});
    rmSync(markerPath, { force: true });

    let result: { includedWelcomeText: boolean } | undefined;
    const captured = await captureAsyncOutput(async () => {
      result = await printBanner({ version: "2.2.0" });
    });

    expect(result).toEqual({ includedWelcomeText: true });
    expectSemanticText(captured.stderr, {
      includes: ["v2.2.0", "privacy-pools init", "privacy-pools --help"],
    });
    expect(existsSync(markerPath)).toBe(true);

    rmSync(markerPath, { force: true });
  });
});
