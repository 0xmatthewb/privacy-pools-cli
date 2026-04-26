import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { printBanner } from "../../src/utils/banner.ts";
import { captureAsyncOutput } from "../helpers/output.ts";

const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_COLUMNS = process.env.COLUMNS;
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
  setStderrTty(Boolean(ORIGINAL_STDERR_IS_TTY));
});

describe("banner runtime", () => {
  test("prints the banner once per session and writes the marker file", async () => {
    const sessionId = `banner:test/session:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "1.2.3");
    process.env.TERM_SESSION_ID = sessionId;
    rmSync(markerPath, { force: true });

    const first = await captureAsyncOutput(async () => {
      await printBanner({
        version: "1.2.3",
        repository: "github.com/example/repo",
      });
    });

    expect(first.stdout).toBe("");
    expect(first.stderr).toContain("A compliant way to transact privately on Ethereum.");
    expect(first.stderr).toContain("v1.2.3");
    expect(existsSync(markerPath)).toBe(true);

    const second = await captureAsyncOutput(async () => {
      await printBanner({
        version: "1.2.3",
        repository: "github.com/example/repo",
      });
    });

    expect(second.stdout).toBe("");
    expect(second.stderr).toBe("");

    rmSync(markerPath, { force: true });
  });

  test("returns includedWelcomeText: true for non-TTY output", async () => {
    const sessionId = `banner:test/welcome:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "1.2.3");
    process.env.TERM_SESSION_ID = sessionId;
    rmSync(markerPath, { force: true });

    let result: { includedWelcomeText: boolean } | undefined;
    await captureAsyncOutput(async () => {
      result = await printBanner({
        version: "1.2.3",
      });
    });

    expect(result).toEqual({ includedWelcomeText: true });

    rmSync(markerPath, { force: true });
  });

  test("returns includedWelcomeText: false when already shown", async () => {
    const sessionId = `banner:test/repeat:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId, "1.0.0");
    process.env.TERM_SESSION_ID = sessionId;
    rmSync(markerPath, { force: true });

    await captureAsyncOutput(async () => {
      await printBanner({ version: "1.0.0" });
    });

    let result: { includedWelcomeText: boolean } | undefined;
    await captureAsyncOutput(async () => {
      result = await printBanner({ version: "1.0.0" });
    });

    expect(result).toEqual({ includedWelcomeText: false });

    rmSync(markerPath, { force: true });
  });
});
