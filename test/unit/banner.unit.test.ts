import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { printBanner } from "../../src/utils/banner.ts";
import { captureAsyncOutput } from "../helpers/output.ts";

const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;

function markerPathFor(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return join(tmpdir(), `privacy-pools-banner-${sanitized}.shown`);
}

afterEach(() => {
  if (ORIGINAL_TERM_SESSION_ID === undefined) {
    delete process.env.TERM_SESSION_ID;
  } else {
    process.env.TERM_SESSION_ID = ORIGINAL_TERM_SESSION_ID;
  }
});

describe("banner runtime", () => {
  test("prints the banner once per session and writes the marker file", async () => {
    const sessionId = `banner:test/session:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const markerPath = markerPathFor(sessionId);
    process.env.TERM_SESSION_ID = sessionId;
    rmSync(markerPath, { force: true });

    const first = await captureAsyncOutput(() =>
      printBanner({
        version: "1.2.3",
        repository: "github.com/example/repo",
      }),
    );

    expect(first.stdout).toBe("");
    expect(first.stderr).toContain("A compliant way to transact privately on Ethereum.");
    expect(first.stderr).toContain("github.com/example/repo");
    expect(existsSync(markerPath)).toBe(true);

    const second = await captureAsyncOutput(() =>
      printBanner({
        version: "1.2.3",
        repository: "github.com/example/repo",
      }),
    );

    expect(second.stdout).toBe("");
    expect(second.stderr).toBe("");

    rmSync(markerPath, { force: true });
  });
});
