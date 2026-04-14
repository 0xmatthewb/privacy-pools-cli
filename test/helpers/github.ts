/**
 * Reads source-of-truth files for conformance checks.
 *
 * Preferred order:
 *   1. Explicit local checkout overrides (CONFORMANCE_CORE_ROOT / CONFORMANCE_FRONTEND_ROOT)
 *   2. Known local sibling checkouts when present
 *   3. Public raw GitHub content (main or CONFORMANCE_UPSTREAM_REF)
 *   4. Shallow git checkout fallback when raw fetch is unavailable
 *
 * Set CONFORMANCE_REQUIRE_LOCAL_SOURCES=1 to fail closed when a local source
 * checkout for the core/frontend repo is unavailable.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, "..", "..");

const RAW_BASE = "https://raw.githubusercontent.com";

const FETCH_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 30_000;

export const CORE_REPO = "0xbow-io/privacy-pools-core";
export const FRONTEND_REPO = "0xbow-io/privacy-pools-website";

const cache = new Map<string, string>();
const checkoutCache = new Map<string, string>();
let cleanupRegistered = false;
let execGitCommand: typeof execFileSync = execFileSync;

function upstreamRefFor(): string {
  return process.env.CONFORMANCE_UPSTREAM_REF || "main";
}

function requireLocalSources(): boolean {
  const raw = process.env.CONFORMANCE_REQUIRE_LOCAL_SOURCES?.trim();
  if (!raw) return false;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

function resolveLocalSourceRoot(repo: string): string | null {
  const envRoot =
    repo === CORE_REPO
      ? process.env.CONFORMANCE_CORE_ROOT
      : repo === FRONTEND_REPO
        ? process.env.CONFORMANCE_FRONTEND_ROOT
        : undefined;

  const candidates = [
    envRoot?.trim(),
    repo === CORE_REPO
      ? resolve(CLI_ROOT, "..", "..", "docs", "privacy-pools-core-main")
      : repo === FRONTEND_REPO
        ? resolve(CLI_ROOT, "..", "privacy-pools-website")
        : undefined,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readLocalSourceFile(repo: string, path: string): string {
  const localRoot = resolveLocalSourceRoot(repo);
  if (!localRoot) {
    throw new Error(`No local source root configured for ${repo}`);
  }

  const filePath = resolve(localRoot, path);
  if (!existsSync(filePath)) {
    throw new Error(`Local source checkout missing ${filePath}`);
  }

  return readFileSync(filePath, "utf8");
}

function cleanupCheckoutDir(checkoutDir: string): void {
  try {
    rmSync(checkoutDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  } catch {
    // Best effort cleanup only.
  }
}

function ensureCheckoutCleanupRegistered(): void {
  if (cleanupRegistered) {
    return;
  }

  cleanupRegistered = true;
  process.on("exit", () => {
    for (const dir of checkoutCache.values()) {
      cleanupCheckoutDir(dir);
    }
  });
}

function readGitHubFileViaCheckout(repo: string, path: string): string {
  const ref = upstreamRefFor();
  const key = `${repo}@${ref}`;
  let checkoutDir = checkoutCache.get(key);

  if (!checkoutDir) {
    checkoutDir = mkdtempSync(resolve(tmpdir(), "privacy-pools-upstream-"));
    const remote = `https://github.com/${repo}.git`;
    try {
      execGitCommand("git", ["init", "-q", checkoutDir], {
        stdio: "pipe",
        timeout: GIT_TIMEOUT_MS,
      });
      execGitCommand(
        "git",
        ["-C", checkoutDir, "remote", "add", "origin", remote],
        {
          stdio: "pipe",
          timeout: GIT_TIMEOUT_MS,
        },
      );
      execGitCommand(
        "git",
        ["-C", checkoutDir, "fetch", "--depth", "1", "origin", ref],
        {
          stdio: "pipe",
          timeout: GIT_TIMEOUT_MS,
        },
      );
      execGitCommand(
        "git",
        ["-C", checkoutDir, "checkout", "--detach", "-q", "FETCH_HEAD"],
        {
          stdio: "pipe",
          timeout: GIT_TIMEOUT_MS,
        },
      );
    } catch (error) {
      cleanupCheckoutDir(checkoutDir);
      throw error;
    }

    checkoutCache.set(key, checkoutDir);
    ensureCheckoutCleanupRegistered();
  }

  const filePath = resolve(checkoutDir, path);
  if (!existsSync(filePath)) {
    throw new Error(`Git checkout missing ${repo}/${ref}/${path}`);
  }

  return readFileSync(filePath, "utf8");
}

export const githubTestInternals = {
  clearCaches(): void {
    cache.clear();
    for (const dir of checkoutCache.values()) {
      cleanupCheckoutDir(dir);
    }
    checkoutCache.clear();
  },
  getCachedCheckoutDirs(): string[] {
    return Array.from(checkoutCache.values());
  },
  setExecFileSyncForTests(execImpl: typeof execFileSync): void {
    execGitCommand = execImpl;
  },
  resetExecFileSyncForTests(): void {
    execGitCommand = execFileSync;
  },
};

export async function fetchGitHubFile(
  repo: string,
  path: string,
): Promise<string> {
  const localRoot = resolveLocalSourceRoot(repo);
  const key = localRoot
    ? `${localRoot}:${path}`
    : `${repo}@${upstreamRefFor()}:${path}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  if (localRoot) {
    const text = readLocalSourceFile(repo, path);
    cache.set(key, text);
    return text;
  }

  if (
    requireLocalSources()
    && (repo === CORE_REPO || repo === FRONTEND_REPO)
  ) {
    throw new Error(
      `Local source checkout required for ${repo}; set CONFORMANCE_CORE_ROOT/CONFORMANCE_FRONTEND_ROOT or place the expected sibling checkout in the workspace.`,
    );
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
