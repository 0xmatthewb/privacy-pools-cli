/**
 * Fetches raw files from public GitHub repos (main branch).
 * Results are cached in-memory so each file is fetched at most once per run.
 */

const RAW_BASE = "https://raw.githubusercontent.com";
const BRANCH = "main";

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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} \u2192 ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  cache.set(key, text);
  return text;
}
