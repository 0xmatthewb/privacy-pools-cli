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

import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────────────

const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pp-upd-test-"));
  homes.push(home);
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
  checkForUpdateInBackground: (currentVersion: string) => void;
}> {
  importCounter++;
  // Dynamic import with unique query string to bypass module cache.
  return import(`../../src/utils/update-check.ts?bust=${importCounter}`);
}

afterAll(() => {
  for (const h of homes) {
    try {
      rmSync(h, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch { /* best effort */ }
  }
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
      checkForUpdateInBackground("1.0.0");
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
