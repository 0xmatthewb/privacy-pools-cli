/**
 * Shared output primitives for command renderers.
 *
 * Re-exports mode resolution and provides a thin, mode-aware render context
 * that individual command renderers consume.  Keeps JSON envelope source of
 * truth in `utils/json.ts` and formatting helpers in `utils/format.ts`.
 */
import { printJsonSuccess } from "../utils/json.js";
import { info, success, warn, printTable, } from "../utils/format.js";
// ── Re-exports so renderers only need one import ─────────────────────────────
export { printJsonSuccess, info, success, warn, printTable, };
/**
 * Create an output context from resolved mode and verbose flag.
 */
export function createOutputContext(mode, isVerbose = false) {
    return { mode, isVerbose };
}
/**
 * Whether human-mode informational messages should be suppressed.
 * True when quiet *or* JSON mode is active.
 */
export function isSilent(ctx) {
    return ctx.mode.isQuiet || ctx.mode.isJson;
}
