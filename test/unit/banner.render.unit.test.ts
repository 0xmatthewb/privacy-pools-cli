import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { printBanner } from "../../src/utils/banner.ts";
import { captureAsyncOutput } from "../helpers/output.ts";
import { expectSemanticText } from "../helpers/contract-assertions.ts";

const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_COLUMNS = process.env.COLUMNS;
const ORIGINAL_BANNER_ART = process.env.PRIVACY_POOLS_BANNER_ART;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;

function markerPathFor(sessionId: string, version = "unknown"): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return join(tmpdir(), `privacy-pools-banner-${sanitized}-v${version}.shown`);
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
  if (ORIGINAL_BANNER_ART === undefined) {
    delete process.env.PRIVACY_POOLS_BANNER_ART;
  } else {
    process.env.PRIVACY_POOLS_BANNER_ART = ORIGINAL_BANNER_ART;
  }
  setStderrTty(Boolean(ORIGINAL_STDERR_IS_TTY));
});

describe("banner render layouts", () => {
  test("narrow tty: banner renders nothing, welcome screen takes over", async () => {
    // Narrow fallback: we intentionally render *no* banner output and return
    // includedWelcomeText=false so the caller's welcomeScreen() prints the
    // wordmark/tagline/version/actions exactly once (no duplication).
    const sessionId = `banner:test/narrow:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "2.0.0");
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "60";
    setStderrTty(true);
    rmSync(markerPath, { force: true });

    let result: { includedWelcomeText: boolean } | undefined;
    const captured = await captureAsyncOutput(async () => {
      result = await printBanner({ version: "2.0.0" });
    });

    expect(result).toEqual({ includedWelcomeText: false });
    expect(captured.stdout).toBe("");
    expect(existsSync(markerPath)).toBe(true);

    rmSync(markerPath, { force: true });
  });

  test("renders the compact tty layout with welcome text and ripple pool", async () => {
    const sessionId = `banner:test/compact:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "2.0.0");
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "80";
    setStderrTty(true);
    rmSync(markerPath, { force: true });

    let result: { includedWelcomeText: boolean } | undefined;
    const captured = await captureAsyncOutput(async () => {
      result = await printBanner({ version: "2.0.0" });
    });

    expect(result).toEqual({ includedWelcomeText: true });
    expectSemanticText(captured.stdout, {
      includes: ["PRIVACY POOLS", "privacy-pools init", "privacy-pools guide"],
    });
    expect(existsSync(markerPath)).toBe(true);

    rmSync(markerPath, { force: true });
  });

  test("renders the wide tty side-by-side layout and keeps the welcome actions visible", async () => {
    const sessionId = `banner:test/wide:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "2.2.0");
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "120";
    setStderrTty(true);
    rmSync(markerPath, { force: true });

    let result: { includedWelcomeText: boolean } | undefined;
    const captured = await captureAsyncOutput(async () => {
      result = await printBanner({ version: "2.2.0" });
    });

    expect(result).toEqual({ includedWelcomeText: true });
    expectSemanticText(captured.stdout, {
      includes: ["v2.2.0", "privacy-pools init", "privacy-pools --help"],
    });
    expect(existsSync(markerPath)).toBe(true);

    rmSync(markerPath, { force: true });
  });

  test("renders optional state-aware banner hints", async () => {
    const sessionId = `banner:test/hint:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "2.2.0");
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "120";
    setStderrTty(true);
    rmSync(markerPath, { force: true });

    const captured = await captureAsyncOutput(async () => {
      await printBanner({
        version: "2.2.0",
        bannerHint: "Start a guided flow or browse pools before depositing.",
      });
    });

    expectSemanticText(captured.stdout, {
      includes: ["Start a guided flow or browse pools before depositing."],
    });

    rmSync(markerPath, { force: true });
  });

  test("renders the Merkle tree art when the banner art toggle is set", async () => {
    const sessionId = `banner:test/merkle:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "2.3.0");
    process.env.TERM_SESSION_ID = sessionId;
    process.env.COLUMNS = "120";
    process.env.PRIVACY_POOLS_BANNER_ART = "merkle";
    setStderrTty(true);
    rmSync(markerPath, { force: true });

    const captured = await captureAsyncOutput(async () => {
      await printBanner({ version: "2.3.0" });
    });

    expectSemanticText(captured.stdout, {
      includes: ["PRIVACY POOLS", "privacy-pools init"],
    });
    expect(captured.stdout).toContain("◉");
    expect(existsSync(markerPath)).toBe(true);

    rmSync(markerPath, { force: true });
  });
});
