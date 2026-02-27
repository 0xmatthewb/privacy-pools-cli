/**
 * Output module barrel.
 *
 * Re-exports shared primitives and command-specific renderers.
 * Command handlers import from here or from individual renderer files.
 */
export { type OutputContext, type ResolvedGlobalMode, createOutputContext, isSilent, stderrLine, printJsonSuccess, printError, info, success, warn, verbose, spinner, printTable, } from "./common.js";
export { renderGuide } from "./guide.js";
export { renderCapabilities, type CapabilitiesPayload, } from "./capabilities.js";
export { renderCompletionScript, renderCompletionQuery, } from "./completion.js";
export { renderSyncEmpty, renderSyncComplete, type SyncResult, } from "./sync.js";
