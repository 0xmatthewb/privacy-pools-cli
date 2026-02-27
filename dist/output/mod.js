/**
 * Output module barrel.
 *
 * Re-exports shared primitives and command-specific renderers.
 * Command handlers import from here or from individual renderer files.
 */
// Shared primitives
export { createOutputContext, isSilent, stderrLine, printJsonSuccess, printError, info, success, warn, verbose, spinner, printTable, } from "./common.js";
// Command renderers
export { renderGuide } from "./guide.js";
export { renderCapabilities, } from "./capabilities.js";
export { renderCompletionScript, renderCompletionQuery, } from "./completion.js";
export { renderSyncEmpty, renderSyncComplete, } from "./sync.js";
