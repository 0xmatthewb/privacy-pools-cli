import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkForUpdateInBackground,
  consumePostCommandUpdateNotice,
  fetchLatestVersion,
  getUpdateNotice,
  getUpdateNoticeWarning,
  shouldShowPostCommandUpdateNotice,
} from "../../src/utils/update-check.ts";
import { cleanupTrackedTempDirs, createTrackedTempDir } from "../helpers/temp.ts";

function freshHome(): string {
  const home = createTrackedTempDir("pp-update-runtime-");
  mkdirSync(join(home, ".privacy-pools"), { recursive: true });
  return join(home, ".privacy-pools");
}

function writeCacheFile(home: string, data: unknown): void {
  writeFileSync(
    join(home, ".update-check.json"),
    typeof data === "string" ? data : JSON.stringify(data),
    "utf8",
  );
}

function markerPathFor(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return join(
    tmpdir(),
    `privacy-pools-update-notice-${sanitized}.shown`,
  );
}

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_DISABLE = process.env.PP_NO_UPDATE_CHECK;
const ORIGINAL_REGISTRY_URL = process.env.PRIVACY_POOLS_NPM_REGISTRY_URL;
const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_ITERM_SESSION_ID = process.env.ITERM_SESSION_ID;
const ORIGINAL_WT_SESSION = process.env.WT_SESSION;
const ORIGINAL_TMUX = process.env.TMUX;
const ORIGINAL_STY = process.env.STY;
const ORIGINAL_SSH_TTY = process.env.SSH_TTY;
const ORIGINAL_SUPPRESS = process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE;
const ORIGINAL_STDOUT_IS_TTY = process.stdout.isTTY;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  cleanupTrackedTempDirs();
  mock.restore();
  if (ORIGINAL_HOME === undefined) delete process.env.PRIVACY_POOLS_HOME;
  else process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  if (ORIGINAL_DISABLE === undefined) delete process.env.PP_NO_UPDATE_CHECK;
  else process.env.PP_NO_UPDATE_CHECK = ORIGINAL_DISABLE;
  if (ORIGINAL_REGISTRY_URL === undefined) {
    delete process.env.PRIVACY_POOLS_NPM_REGISTRY_URL;
  } else {
    process.env.PRIVACY_POOLS_NPM_REGISTRY_URL = ORIGINAL_REGISTRY_URL;
  }
  if (ORIGINAL_TERM_SESSION_ID === undefined) delete process.env.TERM_SESSION_ID;
  else process.env.TERM_SESSION_ID = ORIGINAL_TERM_SESSION_ID;
  if (ORIGINAL_ITERM_SESSION_ID === undefined) delete process.env.ITERM_SESSION_ID;
  else process.env.ITERM_SESSION_ID = ORIGINAL_ITERM_SESSION_ID;
  if (ORIGINAL_WT_SESSION === undefined) delete process.env.WT_SESSION;
  else process.env.WT_SESSION = ORIGINAL_WT_SESSION;
  if (ORIGINAL_TMUX === undefined) delete process.env.TMUX;
  else process.env.TMUX = ORIGINAL_TMUX;
  if (ORIGINAL_STY === undefined) delete process.env.STY;
  else process.env.STY = ORIGINAL_STY;
  if (ORIGINAL_SSH_TTY === undefined) delete process.env.SSH_TTY;
  else process.env.SSH_TTY = ORIGINAL_SSH_TTY;
  if (ORIGINAL_SUPPRESS === undefined) {
    delete process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE;
  } else {
    process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE = ORIGINAL_SUPPRESS;
  }
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: ORIGINAL_STDOUT_IS_TTY,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: ORIGINAL_STDERR_IS_TTY,
  });
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("update check runtime coverage", () => {
  test("consumePostCommandUpdateNotice uses session markers and only returns once", () => {
    const home = freshHome();
    const sessionId = "runtime/session:one";
    const markerPath = markerPathFor(sessionId);
    rmSync(markerPath, { force: true });

    process.env.PRIVACY_POOLS_HOME = home;
    process.env.TERM_SESSION_ID = sessionId;
    writeCacheFile(home, {
      latestVersion: "9.9.9",
      checkedAt: Date.now(),
    });

    expect(consumePostCommandUpdateNotice("1.0.0")).toContain("9.9.9");
    expect(existsSync(markerPath)).toBe(true);
    expect(consumePostCommandUpdateNotice("1.0.0")).toBeNull();
  });

  test("consumePostCommandUpdateNotice falls back to the ppid marker when session ids are absent", () => {
    const home = freshHome();
    const markerPath = markerPathFor(`ppid-${process.ppid}`);
    rmSync(markerPath, { force: true });

    process.env.PRIVACY_POOLS_HOME = home;
    delete process.env.TERM_SESSION_ID;
    delete process.env.ITERM_SESSION_ID;
    delete process.env.WT_SESSION;
    delete process.env.TMUX;
    delete process.env.STY;
    delete process.env.SSH_TTY;
    writeCacheFile(home, {
      latestVersion: "2.0.0",
      checkedAt: Date.now(),
    });

    expect(consumePostCommandUpdateNotice("1.0.0")).toContain("2.0.0");
    expect(existsSync(markerPath)).toBe(true);
  });

  test("getUpdateNotice respects cache freshness and newer-version checks", () => {
    const home = freshHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeCacheFile(home, {
      latestVersion: "2.0.0",
      checkedAt: Date.now(),
    });
    expect(getUpdateNotice("1.0.0")).toContain("2.0.0");

    writeCacheFile(home, {
      latestVersion: "0.9.0",
      checkedAt: Date.now(),
    });
    expect(getUpdateNotice("1.0.0")).toBeNull();

    writeCacheFile(home, {
      latestVersion: "2.0.0",
      checkedAt: Date.now() - (25 * 60 * 60 * 1000),
    });
    expect(getUpdateNotice("1.0.0")).toBeNull();
  });

  test("getUpdateNoticeWarning returns a structured agent warning from fresh cache", () => {
    const home = freshHome();
    process.env.PRIVACY_POOLS_HOME = home;

    writeCacheFile(home, {
      latestVersion: "2.0.0",
      checkedAt: Date.now(),
    });

    expect(getUpdateNoticeWarning("1.0.0")).toEqual({
      code: "CLI_UPDATE_AVAILABLE",
      category: "update",
      message: "privacy-pools-cli 2.0.0 is available (current 1.0.0).",
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      command: "npm i -g privacy-pools-cli@2.0.0",
    });

    expect(getUpdateNoticeWarning("2.0.0")).toBeNull();
  });

  test("shouldShowPostCommandUpdateNotice honors suppressions, tty state, and command exclusions", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    expect(
      shouldShowPostCommandUpdateNotice({
        route: "status",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(true);

    expect(
      shouldShowPostCommandUpdateNotice({
        route: "upgrade check",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);

    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "completion",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);

    process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE = "1";
    expect(
      shouldShowPostCommandUpdateNotice({
        route: "status",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);
  });

  test("fetchLatestVersion respects registry overrides and returns null for non-ok responses", async () => {
    process.env.PRIVACY_POOLS_NPM_REGISTRY_URL = "https://registry.example.test/latest";
    const fetchMock = mock(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://registry.example.test/latest");
      return {
        ok: true,
        json: async () => ({ version: "3.2.1" }),
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchLatestVersion()).resolves.toBe("3.2.1");

    globalThis.fetch = (async () => ({ ok: false })) as typeof fetch;
    await expect(fetchLatestVersion()).resolves.toBeNull();
  });

  test("checkForUpdateInBackground writes a fresh cache entry and swallows failures", async () => {
    const home = freshHome();
    process.env.PRIVACY_POOLS_HOME = home;
    writeCacheFile(home, {
      latestVersion: "1.0.0",
      checkedAt: Date.now() - (26 * 60 * 60 * 1000),
    });

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ version: "4.5.6" }),
    })) as typeof fetch;

    checkForUpdateInBackground();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const written = JSON.parse(
      readFileSync(join(home, ".update-check.json"), "utf8"),
    ) as { latestVersion: string };
    expect(written.latestVersion).toBe("4.5.6");

    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    expect(() => checkForUpdateInBackground()).not.toThrow();
  });
});
