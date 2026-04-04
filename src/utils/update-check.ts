/**
 * Non-blocking update notification.
 *
 * Checks the npm registry for a newer version of the CLI and caches the
 * result for 24 hours.  The check is fire-and-forget — it never blocks
 * the main flow and all errors are silently swallowed.
 *
 * Disabled via `PP_NO_UPDATE_CHECK=1`.
 *
 * Display: a single dim line shown only on the welcome screen.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { resolveConfigHome } from "../runtime/config-paths.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const CLI_NPM_PACKAGE_NAME = "privacy-pools-cli";
export const REGISTRY_URL = `https://registry.npmjs.org/${CLI_NPM_PACKAGE_NAME}/latest`;
export const UPDATE_CHECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const UPDATE_CHECK_FETCH_TIMEOUT_MS = 5_000;

function registryUrl(): string {
  return process.env.PRIVACY_POOLS_NPM_REGISTRY_URL?.trim() || REGISTRY_URL;
}

function configDir(): string {
  return resolveConfigHome();
}

function cachePath(): string {
  return join(configDir(), ".update-check.json");
}

// ── Cache types ──────────────────────────────────────────────────────────────

interface UpdateCache {
  latestVersion: string;
  checkedAt: number; // epoch ms
}

function readCache(): UpdateCache | null {
  try {
    const raw = readFileSync(cachePath(), "utf-8");
    const parsed = JSON.parse(raw) as UpdateCache;
    if (
      typeof parsed.latestVersion === "string" &&
      typeof parsed.checkedAt === "number"
    ) {
      return parsed;
    }
  } catch {
    // Missing or corrupt — treat as no cache.
  }
  return null;
}

function writeCache(cache: UpdateCache): void {
  try {
    const dir = configDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache), "utf-8");
  } catch {
    // Best effort — silently ignore write failures.
  }
}

// ── Semver comparison (major.minor.patch only) ───────────────────────────────

export function parseVersion(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  if (!l || !c) return false;
  if (l[0] !== c[0]) return l[0] > c[0];
  if (l[1] !== c[1]) return l[1] > c[1];
  return l[2] > c[2];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a dim one-line notice if a newer version is available, or null.
 * Reads from cache only — never performs a network call.
 */
export function getUpdateNotice(currentVersion: string): string | null {
  if (process.env.PP_NO_UPDATE_CHECK === "1") return null;

  const cache = readCache();
  if (!cache) return null;

  // Only show if cached value is fresh enough and actually newer.
  const age = Date.now() - cache.checkedAt;
  if (age > UPDATE_CHECK_CACHE_TTL_MS) return null;
  if (!isNewer(cache.latestVersion, currentVersion)) return null;

  return (
    `  Update available: ${currentVersion} \u2192 ${cache.latestVersion}  ` +
    `(npm i -g ${CLI_NPM_PACKAGE_NAME}@${cache.latestVersion})`
  );
}

/**
 * Fire-and-forget background fetch of the latest version from npm.
 * Updates the cache file on success.  All errors are silently swallowed.
 */
export function checkForUpdateInBackground(): void {
  if (process.env.PP_NO_UPDATE_CHECK === "1") return;

  // Skip if cache is still fresh.
  const cache = readCache();
  if (cache && Date.now() - cache.checkedAt < UPDATE_CHECK_CACHE_TTL_MS) return;

  // Fire and forget — we intentionally do not await this.
  fetchLatestVersion()
    .then((latest) => {
      if (latest) {
        writeCache({ latestVersion: latest, checkedAt: Date.now() });
      }
    })
    .catch(() => {
      // Silently ignore all errors.
    });
}

export async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    UPDATE_CHECK_FETCH_TIMEOUT_MS,
  );
  try {
    const res = await fetch(registryUrl(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string };
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
