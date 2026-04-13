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

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
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

/**
 * Import the module fresh each time so PRIVACY_POOLS_HOME changes take effect.
 * Bun caches module state, so we bust the cache with a query param.
 */
let importCounter = 0;
async function importUpdateCheck(): Promise<{
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
}> {
  importCounter++;
  // Dynamic import with unique query string to bypass module cache.
  return import(`../../src/utils/update-check.ts?bust=${importCounter}`);
}

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_DISABLE = process.env.PP_NO_UPDATE_CHECK;
const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_STDOUT_IS_TTY = process.stdout.isTTY;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;

afterEach(() => {
  cleanupTrackedTempDirs();
  if (ORIGINAL_HOME === undefined) delete process.env.PRIVACY_POOLS_HOME;
  else process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  if (ORIGINAL_DISABLE === undefined) delete process.env.PP_NO_UPDATE_CHECK;
  else process.env.PP_NO_UPDATE_CHECK = ORIGINAL_DISABLE;
  if (ORIGINAL_TERM_SESSION_ID === undefined) delete process.env.TERM_SESSION_ID;
  else process.env.TERM_SESSION_ID = ORIGINAL_TERM_SESSION_ID;
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: ORIGINAL_STDOUT_IS_TTY,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: ORIGINAL_STDERR_IS_TTY,
  });
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
});
