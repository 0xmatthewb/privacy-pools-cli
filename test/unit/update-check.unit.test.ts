/**
 * Unit tests for src/utils/update-check.ts
 *
 * Tests the update-check decision logic: cache reading, TTL staleness,
 * version comparison, and the PP_NO_UPDATE_CHECK disable flag.
 *
 * These tests control behavior by writing cache files directly and
 * setting PRIVACY_POOLS_HOME to isolated temp directories.  Network
 * fetch behavior is NOT tested here (fire-and-forget with full error
 * swallowing — not worth the mocking complexity).
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTrackedTempDirs, createTrackedTempDir } from "../helpers/temp.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function freshHome(): string {
  const home = createTrackedTempDir("pp-upd-test-");
  // Create the .privacy-pools dir inside (matches configDir() logic).
  mkdirSync(join(home, ".privacy-pools"), { recursive: true });
  return home;
}

function writeCacheFile(
  home: string,
  data: unknown
): void {
  writeFileSync(
    join(home, ".privacy-pools", ".update-check.json"),
    typeof data === "string" ? data : JSON.stringify(data),
    "utf-8"
  );
}

function updateNoticeMarkerPathFor(configHome: string, sessionId: string): string {
  return join(
    configHome,
    ".session-markers",
    `privacy-pools-update-notice-${sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)}.shown`,
  );
}

/**
 * Import the module fresh each time so PRIVACY_POOLS_HOME changes take effect.
 * Bun caches module state, so we bust the cache with a query param.
 */
let importCounter = 0;
async function importUpdateCheck(): Promise<{
  parseVersion: (value: string) => [number, number, number] | null;
  getUpdateNotice: (currentVersion: string) => string | null;
  checkForUpdateInBackground: () => void;
  consumePostCommandUpdateNotice: (currentVersion: string) => string | null;
  shouldShowPostCommandUpdateNotice: (params: {
    firstCommandToken?: string;
    route?: string | null;
    isWelcome: boolean;
    isMachineMode: boolean;
    isQuiet: boolean;
    isHelpLike: boolean;
    isVersionLike: boolean;
  }) => boolean;
  fetchLatestVersion: () => Promise<string | null>;
}> {
  importCounter++;
  // Dynamic import with unique query string to bypass module cache.
  return import(`../../src/utils/update-check.ts?bust=${importCounter}`);
}

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_DISABLE = process.env.PP_NO_UPDATE_CHECK;
const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_REGISTRY_URL = process.env.PRIVACY_POOLS_NPM_REGISTRY_URL;
const ORIGINAL_SUPPRESS_POST_COMMAND_NOTICE =
  process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE;
const ORIGINAL_STDOUT_IS_TTY = process.stdout.isTTY;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  cleanupTrackedTempDirs();
  if (ORIGINAL_HOME === undefined) delete process.env.PRIVACY_POOLS_HOME;
  else process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  if (ORIGINAL_DISABLE === undefined) delete process.env.PP_NO_UPDATE_CHECK;
  else process.env.PP_NO_UPDATE_CHECK = ORIGINAL_DISABLE;
  if (ORIGINAL_TERM_SESSION_ID === undefined) delete process.env.TERM_SESSION_ID;
  else process.env.TERM_SESSION_ID = ORIGINAL_TERM_SESSION_ID;
  if (ORIGINAL_REGISTRY_URL === undefined) {
    delete process.env.PRIVACY_POOLS_NPM_REGISTRY_URL;
  } else {
    process.env.PRIVACY_POOLS_NPM_REGISTRY_URL = ORIGINAL_REGISTRY_URL;
  }
  if (ORIGINAL_SUPPRESS_POST_COMMAND_NOTICE === undefined) {
    delete process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE;
  } else {
    process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE =
      ORIGINAL_SUPPRESS_POST_COMMAND_NOTICE;
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
  mock.restore();
});

// ── PP_NO_UPDATE_CHECK=1 disables everything ────────────────────────────────

describe("PP_NO_UPDATE_CHECK", () => {
  test("getUpdateNotice returns null when PP_NO_UPDATE_CHECK=1", async () => {
    const home = freshHome();
    writeCacheFile(home, {
      latestVersion: "99.0.0",
      checkedAt: Date.now(),
    });

    const prev = process.env.PP_NO_UPDATE_CHECK;
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    try {
      process.env.PP_NO_UPDATE_CHECK = "1";
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      expect(getUpdateNotice("1.0.0")).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prev;
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
    }
  });

  test("checkForUpdateInBackground is a no-op when PP_NO_UPDATE_CHECK=1", async () => {
    const home = freshHome();
    const prev = process.env.PP_NO_UPDATE_CHECK;
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    try {
      process.env.PP_NO_UPDATE_CHECK = "1";
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { checkForUpdateInBackground } = await importUpdateCheck();
      // Should return immediately without throwing.
      checkForUpdateInBackground();
    } finally {
      if (prev === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prev;
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
    }
  });
});

// ── Cache reading: missing, malformed, corrupt ──────────────────────────────

describe("cache resilience", () => {
  test("returns null when no cache file exists", async () => {
    const home = freshHome();
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    const prevDisable = process.env.PP_NO_UPDATE_CHECK;
    try {
      delete process.env.PP_NO_UPDATE_CHECK;
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      expect(getUpdateNotice("1.0.0")).toBeNull();
    } finally {
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
      if (prevDisable === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prevDisable;
    }
  });

  test("returns null for malformed JSON in cache", async () => {
    const home = freshHome();
    writeCacheFile(home, "not valid json {{{");
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    const prevDisable = process.env.PP_NO_UPDATE_CHECK;
    try {
      delete process.env.PP_NO_UPDATE_CHECK;
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      expect(getUpdateNotice("1.0.0")).toBeNull();
    } finally {
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
      if (prevDisable === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prevDisable;
    }
  });

  test("returns null for cache with wrong shape (missing fields)", async () => {
    const home = freshHome();
    writeCacheFile(home, { someOtherField: true });
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    const prevDisable = process.env.PP_NO_UPDATE_CHECK;
    try {
      delete process.env.PP_NO_UPDATE_CHECK;
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      expect(getUpdateNotice("1.0.0")).toBeNull();
    } finally {
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
      if (prevDisable === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prevDisable;
    }
  });

  test("returns null for cache with wrong types", async () => {
    const home = freshHome();
    writeCacheFile(home, { latestVersion: 123, checkedAt: "not-a-number" });
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    const prevDisable = process.env.PP_NO_UPDATE_CHECK;
    try {
      delete process.env.PP_NO_UPDATE_CHECK;
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      expect(getUpdateNotice("1.0.0")).toBeNull();
    } finally {
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
      if (prevDisable === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prevDisable;
    }
  });
});

// ── TTL / staleness ─────────────────────────────────────────────────────────

describe("cache TTL", () => {
  test("returns null when cache is older than 24 hours", async () => {
    const home = freshHome();
    const staleTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25h ago
    writeCacheFile(home, {
      latestVersion: "99.0.0",
      checkedAt: staleTimestamp,
    });
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    const prevDisable = process.env.PP_NO_UPDATE_CHECK;
    try {
      delete process.env.PP_NO_UPDATE_CHECK;
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      expect(getUpdateNotice("1.0.0")).toBeNull();
    } finally {
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
      if (prevDisable === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prevDisable;
    }
  });

  test("returns notice when cache is fresh (< 24 hours)", async () => {
    const home = freshHome();
    writeCacheFile(home, {
      latestVersion: "99.0.0",
      checkedAt: Date.now(),
    });
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    const prevDisable = process.env.PP_NO_UPDATE_CHECK;
    try {
      delete process.env.PP_NO_UPDATE_CHECK;
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      const notice = getUpdateNotice("1.0.0");
      expect(notice).not.toBeNull();
      expect(notice).toContain("99.0.0");
      expect(notice).toContain("npm i -g");
    } finally {
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
      if (prevDisable === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prevDisable;
    }
  });
});

// ── Version comparison ──────────────────────────────────────────────────────

describe("version comparison via getUpdateNotice", () => {
  // Helper: set up a fresh cache with the given "latest" version, then call
  // getUpdateNotice with the given "current" version.
  async function noticeFor(
    latest: string,
    current: string
  ): Promise<string | null> {
    const home = freshHome();
    writeCacheFile(home, { latestVersion: latest, checkedAt: Date.now() });
    const prevHome = process.env.PRIVACY_POOLS_HOME;
    const prevDisable = process.env.PP_NO_UPDATE_CHECK;
    try {
      delete process.env.PP_NO_UPDATE_CHECK;
      process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
      const { getUpdateNotice } = await importUpdateCheck();
      return getUpdateNotice(current);
    } finally {
      if (prevHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
      else process.env.PRIVACY_POOLS_HOME = prevHome;
      if (prevDisable === undefined) delete process.env.PP_NO_UPDATE_CHECK;
      else process.env.PP_NO_UPDATE_CHECK = prevDisable;
    }
  }

  test("shows notice when major version is newer", async () => {
    expect(await noticeFor("2.0.0", "1.0.0")).not.toBeNull();
  });

  test("shows notice when minor version is newer", async () => {
    expect(await noticeFor("1.1.0", "1.0.0")).not.toBeNull();
  });

  test("shows notice when patch version is newer", async () => {
    expect(await noticeFor("1.0.1", "1.0.0")).not.toBeNull();
  });

  test("returns null when versions are equal", async () => {
    expect(await noticeFor("1.0.0", "1.0.0")).toBeNull();
  });

  test("returns null when current is newer than cached", async () => {
    expect(await noticeFor("1.0.0", "2.0.0")).toBeNull();
  });

  test("returns null for unparseable cached version", async () => {
    expect(await noticeFor("not-a-version", "1.0.0")).toBeNull();
  });

  test("returns null for unparseable current version", async () => {
    expect(await noticeFor("2.0.0", "garbage")).toBeNull();
  });

  test("parseVersion accepts simple semver prefixes and rejects invalid inputs", async () => {
    const { parseVersion } = await importUpdateCheck();

    expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("post-command update notices", () => {
  test("shows a cached notice only once per terminal session", async () => {
    const home = freshHome();
    writeCacheFile(home, {
      latestVersion: "9.9.9",
      checkedAt: Date.now(),
    });
    process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
    process.env.TERM_SESSION_ID = `pp-update-test-${Date.now()}`;

    const { consumePostCommandUpdateNotice } = await importUpdateCheck();
    expect(consumePostCommandUpdateNotice("1.0.0")).toContain("9.9.9");
    expect(consumePostCommandUpdateNotice("1.0.0")).toBeNull();
  });

  test("gates post-command notices to successful human TTY commands", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    const { shouldShowPostCommandUpdateNotice } = await importUpdateCheck();
    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "status",
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
        firstCommandToken: "completion",
        route: "completion",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "status",
        route: "status",
        isWelcome: false,
        isMachineMode: true,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);
  });

  test("suppresses post-command notices for explicit opt-outs, help/version flows, and non-tty output", async () => {
    process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE = "1";

    const { shouldShowPostCommandUpdateNotice } = await importUpdateCheck();
    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "status",
        route: "status",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);

    delete process.env.PRIVACY_POOLS_CLI_SUPPRESS_POST_COMMAND_UPDATE_NOTICE;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: false,
    });

    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "upgrade",
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
        firstCommandToken: "status",
        route: "status",
        isWelcome: true,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "status",
        route: "status",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: true,
        isVersionLike: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "status",
        route: "status",
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: true,
      }),
    ).toBe(false);
  });

  test("falls back to the current process id when session env vars are unavailable", async () => {
    const home = freshHome();
    writeCacheFile(home, {
      latestVersion: "9.9.9",
      checkedAt: Date.now(),
    });
    process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");

    const sessionEnvKeys = [
      "TERM_SESSION_ID",
      "ITERM_SESSION_ID",
      "WT_SESSION",
      "TMUX",
      "STY",
      "SSH_TTY",
    ] as const;
    const previousSessionEnv = Object.fromEntries(
      sessionEnvKeys.map((key) => [key, process.env[key]]),
    );
    for (const key of sessionEnvKeys) {
      delete process.env[key];
    }
    rmSync(
      updateNoticeMarkerPathFor(join(home, ".privacy-pools"), `ppid-${process.ppid}`),
      { force: true },
    );

    try {
      const { consumePostCommandUpdateNotice } = await importUpdateCheck();
      expect(consumePostCommandUpdateNotice("1.0.0")).toContain("9.9.9");
      expect(consumePostCommandUpdateNotice("1.0.0")).toBeNull();
    } finally {
      for (const key of sessionEnvKeys) {
        const previousValue = previousSessionEnv[key];
        if (previousValue === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previousValue;
        }
      }
    }
  });

  test("falls back to firstCommandToken when the route is unavailable", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    const { shouldShowPostCommandUpdateNotice } = await importUpdateCheck();
    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "upgrade",
        route: null,
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPostCommandUpdateNotice({
        firstCommandToken: "status",
        route: null,
        isWelcome: false,
        isMachineMode: false,
        isQuiet: false,
        isHelpLike: false,
        isVersionLike: false,
      }),
    ).toBe(true);
  });
});

describe("background fetch helpers", () => {
  test("fetchLatestVersion honors the registry override and returns the published version", async () => {
    process.env.PRIVACY_POOLS_NPM_REGISTRY_URL = "https://registry.example.test/latest";
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://registry.example.test/latest");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      return {
        ok: true,
        json: async () => ({ version: "2.3.4" }),
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { fetchLatestVersion } = await importUpdateCheck();
    await expect(fetchLatestVersion()).resolves.toBe("2.3.4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fetchLatestVersion returns null for non-ok, malformed, and thrown responses", async () => {
    const responses = [
      { ok: false, json: async () => ({ version: "9.9.9" }) },
      { ok: true, json: async () => ({}) },
    ];
    const fetchMock = mock(async () => {
      const next = responses.shift();
      if (next) {
        return next as Response;
      }
      throw new Error("network down");
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { fetchLatestVersion } = await importUpdateCheck();
    await expect(fetchLatestVersion()).resolves.toBeNull();
    await expect(fetchLatestVersion()).resolves.toBeNull();
    await expect(fetchLatestVersion()).resolves.toBeNull();
  });

  test("checkForUpdateInBackground persists a fresh version only when the cache is stale", async () => {
    const home = freshHome();
    process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
    const fetchMock = mock(async () => ({
      ok: true,
      json: async () => ({ version: "8.8.8" }),
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const { checkForUpdateInBackground } = await importUpdateCheck();
    checkForUpdateInBackground();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(readFileSync(join(home, ".privacy-pools", ".update-check.json"), "utf-8")),
    ).toMatchObject({
      latestVersion: "8.8.8",
    });

    fetchMock.mockClear();
    checkForUpdateInBackground();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
