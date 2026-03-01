export function resolveGlobalMode(globalOpts) {
    const isAgent = globalOpts?.agent ?? false;
    const isJson = (globalOpts?.json ?? false) || isAgent;
    const isQuiet = (globalOpts?.quiet ?? false) || isAgent;
    // JSON/machine mode must never block on interactive prompts.
    const skipPrompts = (globalOpts?.yes ?? false) || isAgent || isJson;
    // Persist timeout from global flags for services to pick up.
    if (globalOpts?.timeout !== undefined) {
        setNetworkTimeoutMs(parseTimeoutFlag(globalOpts.timeout));
    }
    return { isAgent, isJson, isQuiet, skipPrompts };
}
const DEFAULT_NETWORK_TIMEOUT_MS = 30_000;
let _networkTimeoutMs = DEFAULT_NETWORK_TIMEOUT_MS;
function parseTimeoutFlag(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return DEFAULT_NETWORK_TIMEOUT_MS;
    return Math.round(seconds * 1000);
}
function setNetworkTimeoutMs(ms) {
    _networkTimeoutMs = ms;
}
/** Returns the network timeout in milliseconds (default 30 000). */
export function getNetworkTimeoutMs() {
    return _networkTimeoutMs;
}
