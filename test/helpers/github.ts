/**
 * Reads source-of-truth files for conformance checks.
 *
 * Preferred order:
 *   1. Local checked-out source repos beside this workspace
 *   2. Explicit CONFORMANCE_*_ROOT env overrides
 *   3. Public GitHub fallback (main or CONFORMANCE_UPSTREAM_REF)
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CLI_ROOT } from "./paths.ts";

const RAW_BASE = "https://raw.githubusercontent.com";

const FETCH_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 30_000;

export const CORE_REPO = "0xbow-io/privacy-pools-core";
export const FRONTEND_REPO = "0xbow-io/privacy-pools-website";
export const LOCAL_CORE_ROOT =
  process.env.CONFORMANCE_CORE_ROOT ||
  resolve(CLI_ROOT, "..", "..", "docs", "privacy-pools-core-main");
export const LOCAL_FRONTEND_ROOT =
  process.env.CONFORMANCE_FRONTEND_ROOT ||
  resolve(CLI_ROOT, "..", "privacy-pools-website");

const cache = new Map<string, string>();
const checkoutCache = new Map<string, string>();
let cleanupRegistered = false;

function upstreamRefFor(): string {
  return process.env.CONFORMANCE_UPSTREAM_REF || "main";
}

function localRepoRoot(repo: string): string | null {
  if (repo === CORE_REPO) return LOCAL_CORE_ROOT;
  if (repo === FRONTEND_REPO) return LOCAL_FRONTEND_ROOT;
  return null;
}

function readGitHubFileViaCheckout(repo: string, path: string): string {
  const ref = upstreamRefFor();
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
  const localRoot = localRepoRoot(repo);
  const key = `${localRoot ?? repo}@${upstreamRefFor()}:${path}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  if (localRoot && existsSync(localRoot)) {
    const filePath = resolve(localRoot, path);
    if (!existsSync(filePath)) {
      throw new Error(`Local source checkout missing ${repo}/${path} at ${filePath}`);
    }
    const text = readFileSync(filePath, "utf8");
    cache.set(key, text);
    return text;
  }

  const ref = upstreamRefFor();
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
