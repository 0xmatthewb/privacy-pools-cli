export function resolveGlobalMode(globalOpts) {
    const isAgent = globalOpts?.agent ?? false;
    const isJson = (globalOpts?.json ?? false) || isAgent;
    const isQuiet = (globalOpts?.quiet ?? false) || isAgent;
    // JSON/machine mode must never block on interactive prompts.
    const skipPrompts = (globalOpts?.yes ?? false) || isAgent || isJson;
    return { isAgent, isJson, isQuiet, skipPrompts };
}
