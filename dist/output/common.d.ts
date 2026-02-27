/**
 * Shared output primitives for command renderers.
 *
 * Re-exports mode resolution and provides a thin, mode-aware render context
 * that individual command renderers consume.  Keeps JSON envelope source of
 * truth in `utils/json.ts` and formatting helpers in `utils/format.ts`.
 */
import type { ResolvedGlobalMode } from "../utils/mode.js";
import { printJsonSuccess } from "../utils/json.js";
import { info, success, warn, printTable } from "../utils/format.js";
export { printJsonSuccess, info, success, warn, printTable, };
export type { ResolvedGlobalMode };
/**
 * Output context passed from the command handler to a renderer.
 *
 * Bundles resolved mode flags with convenience getters that renderers
 * reference frequently.  Commands construct this once and hand it off.
 */
export interface OutputContext {
    /** Resolved global mode (json, quiet, agent, skipPrompts). */
    mode: ResolvedGlobalMode;
    /** True when verbose output is requested. */
    isVerbose: boolean;
}
/**
 * Create an output context from resolved mode and verbose flag.
 */
export declare function createOutputContext(mode: ResolvedGlobalMode, isVerbose?: boolean): OutputContext;
/**
 * Whether human-mode informational messages should be suppressed.
 * True when quiet *or* JSON mode is active.
 */
export declare function isSilent(ctx: OutputContext): boolean;
