import { CLIError } from "../utils/errors.js";
async function aspFetch(chainConfig, path, scope, query) {
    const url = new URL(`${chainConfig.aspHost}/${chainConfig.id}${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            url.searchParams.set(k, v);
        }
    }
    const headers = {};
    if (scope !== undefined) {
        // Must be decimal string, never hex
        headers["X-Pool-Scope"] = scope.toString();
    }
    const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        if (res.status === 404) {
            throw new CLIError(`ASP API: resource not found (${path}). Check that the pool scope is correct.`, "ASP", "Ensure X-Pool-Scope is a decimal string, not hex.");
        }
        if (res.status === 400) {
            throw new CLIError(`ASP API: bad request (${path}). Pool scope header may be missing.`, "ASP");
        }
        if (res.status === 429 || res.status === 403) {
            throw new CLIError(`ASP API: rate limited or forbidden (${res.status}).`, "ASP", "Wait and retry with exponential backoff.");
        }
        throw new CLIError(`ASP API request failed: ${res.status} ${res.statusText}`, "ASP");
    }
    return res;
}
export async function fetchMerkleRoots(chainConfig, scope) {
    const res = await aspFetch(chainConfig, "/public/mt-roots", scope);
    return res.json();
}
export async function fetchMerkleLeaves(chainConfig, scope) {
    const res = await aspFetch(chainConfig, "/public/mt-leaves", scope);
    return res.json();
}
export async function fetchPoolsStats(chainConfig) {
    const res = await aspFetch(chainConfig, "/public/pools-stats");
    return res.json();
}
export async function checkLiveness(chainConfig) {
    try {
        const res = await fetch(`${chainConfig.aspHost}/${chainConfig.id}/health/liveness`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok)
            return false;
        const { status } = await res.json();
        return status === "ok";
    }
    catch {
        return false;
    }
}
