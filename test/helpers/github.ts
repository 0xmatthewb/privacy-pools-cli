/**
 * Fetches raw files from public GitHub repos (main branch).
 * Results are cached in-memory so each file is fetched at most once per run.
 */

const RAW_BASE = "https://raw.githubusercontent.com";
/** Set CONFORMANCE_UPSTREAM_REF to a commit SHA for deterministic CI runs. */
const BRANCH = process.env.CONFORMANCE_UPSTREAM_REF || "main";

const FETCH_TIMEOUT_MS = 15_000;

export const CORE_REPO = "0xbow-io/privacy-pools-core";
export const FRONTEND_REPO = "0xbow-io/privacy-pools-website";

const cache = new Map<string, string>();

export async function fetchGitHubFile(
  repo: string,
  path: string,
): Promise<string> {
  const key = `${repo}/${path}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

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
