/**
 * Loads pinned upstream fixture files for hermetic conformance tests and
 * falls back to raw GitHub when no fixture exists.
 *
 * Set CONFORMANCE_FETCH_LIVE=1 to bypass fixtures and fetch from GitHub.
 * Set CONFORMANCE_UPSTREAM_REF to a commit SHA for live fetches.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLI_ROOT } from "./paths.ts";

const RAW_BASE = "https://raw.githubusercontent.com";
/** Set CONFORMANCE_UPSTREAM_REF to a commit SHA for deterministic live fetches. */
const BRANCH = process.env.CONFORMANCE_UPSTREAM_REF || "main";
const FIXTURE_BASE = resolve(CLI_ROOT, "test", "fixtures", "upstream");

const FETCH_TIMEOUT_MS = 15_000;

export const CORE_REPO = "0xbow-io/privacy-pools-core";
export const FRONTEND_REPO = "0xbow-io/privacy-pools-website";
export const CORE_REPO_FIXTURE_REF =
  "a80836a47451e662f127af17e11430ffa976c234";

const cache = new Map<string, string>();

function fixturePathFor(repo: string, path: string): string {
  const repoSlug = repo.replace(/\//g, "__");
  return resolve(FIXTURE_BASE, repoSlug, path);
}

export function readGitHubFixture(
  repo: string,
  path: string,
): string | null {
  const fixturePath = fixturePathFor(repo, path);
  if (!existsSync(fixturePath)) {
    return null;
  }
  return readFileSync(fixturePath, "utf8");
}

export async function fetchGitHubFile(
  repo: string,
  path: string,
): Promise<string> {
  const key = `${repo}/${path}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  if (process.env.CONFORMANCE_FETCH_LIVE !== "1") {
    const fixture = readGitHubFixture(repo, path);
    if (fixture !== null) {
      cache.set(key, fixture);
      return fixture;
    }

    if (repo === CORE_REPO) {
      throw new Error(
        `Missing pinned upstream fixture for ${repo}/${path}. `
        + "Add the file under test/fixtures/upstream or set CONFORMANCE_FETCH_LIVE=1."
      );
    }
  }

  const url = `${RAW_BASE}/${repo}/${BRANCH}/${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`GET ${url} \u2192 ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    cache.set(key, text);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
