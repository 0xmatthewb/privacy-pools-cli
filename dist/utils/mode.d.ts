import type { GlobalOptions } from "../types.js";
export interface ResolvedGlobalMode {
    isAgent: boolean;
    isJson: boolean;
    isQuiet: boolean;
    skipPrompts: boolean;
}
export declare function resolveGlobalMode(globalOpts?: GlobalOptions): ResolvedGlobalMode;
