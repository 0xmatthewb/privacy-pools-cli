/**
 * Loads pinned upstream fixture files for hermetic conformance tests and
 * falls back to live upstream sources when no fixture exists.
 *
 * Set CONFORMANCE_FETCH_LIVE=1 to bypass fixtures and fetch from GitHub.
 * Set CONFORMANCE_UPSTREAM_REF to a commit SHA for live fetches.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CLI_ROOT } from "./paths.ts";

const RAW_BASE = "https://raw.githubusercontent.com";
const FIXTURE_BASE = resolve(CLI_ROOT, "test", "fixtures", "upstream");

const FETCH_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 30_000;

export const CORE_REPO = "0xbow-io/privacy-pools-core";
export const FRONTEND_REPO = "0xbow-io/privacy-pools-website";
export const CORE_REPO_FIXTURE_REF = "a80836a47451e662f127af17e11430ffa976c234";

const cache = new Map<string, string>();
const checkoutCache = new Map<string, string>();
let cleanupRegistered = false;

function upstreamRefFor(repo: string): string {
  return (
    process.env.CONFORMANCE_UPSTREAM_REF ||
    (repo === CORE_REPO ? CORE_REPO_FIXTURE_REF : "main")
  );
}

function fixturePathFor(repo: string, path: string): string {
  const repoSlug = repo.replace(/\//g, "__");
  return resolve(FIXTURE_BASE, repoSlug, path);
}

export function readGitHubFixture(repo: string, path: string): string | null {
  const fixturePath = fixturePathFor(repo, path);
  if (!existsSync(fixturePath)) {
    return null;
  }
  return readFileSync(fixturePath, "utf8");
}

function readGitHubFileViaCheckout(repo: string, path: string): string {
  const ref = upstreamRefFor(repo);
  const key = `${repo}@${ref}`;
  let checkoutDir = checkoutCache.get(key);

  if (!checkoutDir) {
    checkoutDir = mkdtempSync(resolve(tmpdir(), "privacy-pools-upstream-"));
    const remote = `https://github.com/${repo}.git`;

    execFileSync("git", ["init", "-q", checkoutDir], {
      stdio: "pipe",
      timeout: GIT_TIMEOUT_MS,
    });
    execFileSync(
      "git",
      ["-C", checkoutDir, "remote", "add", "origin", remote],
      {
        stdio: "pipe",
        timeout: GIT_TIMEOUT_MS,
      },
    );
    execFileSync(
      "git",
      ["-C", checkoutDir, "fetch", "--depth", "1", "origin", ref],
      {
        stdio: "pipe",
        timeout: GIT_TIMEOUT_MS,
      },
    );
    execFileSync(
      "git",
      ["-C", checkoutDir, "checkout", "--detach", "-q", "FETCH_HEAD"],
      {
        stdio: "pipe",
        timeout: GIT_TIMEOUT_MS,
      },
    );

    checkoutCache.set(key, checkoutDir);

    if (!cleanupRegistered) {
      cleanupRegistered = true;
      process.on("exit", () => {
        for (const dir of checkoutCache.values()) {
          try {
            rmSync(dir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 50,
            });
          } catch {
            // Best effort cleanup only.
          }
        }
      });
    }
  }

  const filePath = resolve(checkoutDir, path);
  if (!existsSync(filePath)) {
    throw new Error(`Git checkout missing ${repo}/${ref}/${path}`);
  }

  return readFileSync(filePath, "utf8");
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
  }

  const ref = upstreamRefFor(repo);
  const url = `${RAW_BASE}/${repo}/${ref}/${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let text: string;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`GET ${url} \u2192 ${res.status} ${res.statusText}`);
      }
      text = await res.text();
    } catch (rawErr) {
      try {
        text = readGitHubFileViaCheckout(repo, path);
      } catch {
        throw rawErr;
      }
    }
    cache.set(key, text);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
