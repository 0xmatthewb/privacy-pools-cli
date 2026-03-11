/**
 * Shared output primitives for command renderers.
 *
 * Re-exports mode resolution and provides a thin, mode-aware render context
 * that individual command renderers consume.  Keeps JSON envelope source of
 * truth in `utils/json.ts` and formatting helpers in `utils/format.ts`.
 */

import type { ResolvedGlobalMode } from "../utils/mode.js";
import { printJsonSuccess } from "../utils/json.js";
import { printCsv } from "./csv.js";
import {
  info,
  success,
  warn,
  printTable,
} from "../utils/format.js";
import { CLIError } from "../utils/errors.js";

// ── Re-exports so renderers only need one import ─────────────────────────────

export {
  printJsonSuccess,
  printCsv,
  info,
  success,
  warn,
  printTable,
};
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
export function createOutputContext(
  mode: ResolvedGlobalMode,
  isVerbose: boolean = false,
): OutputContext {
  return { mode, isVerbose };
}

/**
 * Whether human-mode informational messages should be suppressed.
 * True when quiet, JSON, or CSV mode is active.
 */
export function isSilent(ctx: OutputContext): boolean {
  return ctx.mode.isQuiet || ctx.mode.isJson || ctx.mode.isCsv;
}

/**
 * Whether CSV output is requested.
 */
export function isCsv(ctx: OutputContext): boolean {
  return ctx.mode.isCsv;
}

/** Commands that support `--format csv` output. */
const CSV_SUPPORTED_COMMANDS = ["pools", "accounts", "activity", "stats", "history"];

/**
 * Throw an INPUT error when `--format csv` is used with a command that does
 * not produce tabular data.  Call at the top of any renderer that lacks CSV
 * support.
 */
export function guardCsvUnsupported(ctx: OutputContext, commandName: string): void {
  if (!ctx.mode.isCsv) return;
  throw new CLIError(
    `--format csv is not supported for '${commandName}'.`,
    "INPUT",
    `CSV output is available for: ${CSV_SUPPORTED_COMMANDS.join(", ")}.`,
  );
}
