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
            throw new CLIError(`Withdrawal service: resource not found (${path}).`, "ASP", "The pool may not be registered yet. Run 'privacy-pools pools' to verify.");
        }
        if (res.status === 400) {
            throw new CLIError(`Withdrawal service: bad request (${path}).`, "ASP", "Try 'privacy-pools sync' and retry. If it persists, the CLI may be out of date.");
        }
        if (res.status === 429 || res.status === 403) {
            throw new CLIError(`Withdrawal service: rate limited or forbidden (${res.status}).`, "ASP", "Wait a moment and try again.");
        }
        throw new CLIError(`Withdrawal service request failed: ${res.status} ${res.statusText}`, "ASP", "Check your network connection. If it persists, the service may be temporarily down.");
    }
    return res;
}
async function aspFetchGlobal(chainConfig, path, query) {
    const url = new URL(`${chainConfig.aspHost}/global${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            url.searchParams.set(k, v);
        }
    }
    const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        if (res.status === 429 || res.status === 403) {
            throw new CLIError(`Withdrawal service: rate limited or forbidden (${res.status}).`, "ASP", "Wait a moment and try again.");
        }
        throw new CLIError(`Withdrawal service request failed: ${res.status} ${res.statusText}`, "ASP", "Check your network connection. If it persists, the service may be temporarily down.");
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
export async function fetchPoolEvents(chainConfig, scope, page, perPage) {
    const res = await aspFetch(chainConfig, "/public/events", scope, {
        page: String(page),
        perPage: String(perPage),
    });
    return res.json();
}
export async function fetchGlobalEvents(chainConfig, page, perPage) {
    const res = await aspFetchGlobal(chainConfig, "/public/events", {
        page: String(page),
        perPage: String(perPage),
    });
    return res.json();
}
export async function fetchPoolsStats(chainConfig) {
    const res = await aspFetch(chainConfig, "/public/pools-stats");
    return res.json();
}
export async function fetchDepositsLargerThan(chainConfig, scope, amount) {
    const res = await aspFetch(chainConfig, "/public/deposits-larger-than", scope, { amount: amount.toString() });
    return res.json();
}
export async function fetchPoolStatistics(chainConfig, scope) {
    const res = await aspFetch(chainConfig, "/public/pool-statistics", scope);
    return res.json();
}
export async function fetchGlobalStatistics(chainConfig) {
    const res = await aspFetchGlobal(chainConfig, "/public/statistics");
    return res.json();
}
/**
 * Fetch ASP leaves and return a Set of approved labels for a pool.
 * Returns null if the ASP is unreachable (non-fatal).
 */
export async function fetchApprovedLabels(chainConfig, scope) {
    try {
        const res = await aspFetch(chainConfig, "/public/mt-leaves", scope);
        const { aspLeaves } = (await res.json());
        return new Set(aspLeaves.map((leaf) => BigInt(leaf).toString()));
    }
    catch {
        return null;
    }
}
export async function checkLiveness(chainConfig) {
    try {
        const res = await fetch(`${chainConfig.aspHost}/${chainConfig.id}/health/liveness`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok)
            return false;
        const data = (await res.json());
        return data.status === "ok";
    }
    catch {
        return false;
    }
}
