/**
 * Reads source-of-truth files for conformance checks from public upstream repos.
 *
 * Preferred order:
 *   1. Public raw GitHub content (main or CONFORMANCE_UPSTREAM_REF)
 *   2. Shallow git checkout fallback when raw fetch is unavailable
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const RAW_BASE = "https://raw.githubusercontent.com";

const FETCH_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 30_000;

export const CORE_REPO = "0xbow-io/privacy-pools-core";
export const FRONTEND_REPO = "0xbow-io/privacy-pools-website";

const cache = new Map<string, string>();
const checkoutCache = new Map<string, string>();
let cleanupRegistered = false;

function upstreamRefFor(): string {
  return process.env.CONFORMANCE_UPSTREAM_REF || "main";
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
  const key = `${repo}@${upstreamRefFor()}:${path}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

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
