/**
 * Shared output primitives for command renderers.
 *
 * Re-exports mode resolution and provides a thin, mode-aware render context
 * that individual command renderers consume.  Keeps JSON envelope source of
 * truth in `utils/json.ts` and formatting helpers in `utils/format.ts`.
 */

import chalk from "chalk";
import type { ResolvedGlobalMode } from "../utils/mode.js";
import { printJsonSuccess } from "../utils/json.js";
import { printCsv } from "./csv.js";
import type { NextAction, NextActionOptionValue } from "../types.js";
import {
  info,
  success,
  warn,
  printTable,
} from "../utils/format.js";
import { CLIError } from "../utils/errors.js";
import { accent } from "../utils/theme.js";
import { formatSectionHeading } from "./layout.js";

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

export function createNextAction(
  command: string,
  reason: string,
  when: string,
  config: {
    args?: string[];
    options?: Record<string, NextActionOptionValue>;
    /** False when the command is a template requiring additional user input. */
    runnable?: boolean;
  } = {},
): NextAction {
  const action: NextAction = { command, reason, when };

  if (config.args && config.args.length > 0) {
    action.args = config.args;
  }

  if (config.options) {
    const options = Object.fromEntries(
      Object.entries(config.options).filter(([, value]) => value !== undefined),
    ) as Record<string, NextActionOptionValue>;
    if (Object.keys(options).length > 0) {
      action.options = options;
    }
  }

  if (config.runnable === false) {
    action.runnable = false;
  }

  return withCliCommand(action);
}

export function appendNextActions<T extends Record<string, unknown>>(
  payload: T,
  nextActions: NextAction[] | undefined,
): T & { nextActions?: NextAction[] } {
  return nextActions && nextActions.length > 0
    ? { ...payload, nextActions: nextActions.map(withCliCommand) }
    : { ...payload };
}

// ── Shared human next-step renderer ─────────────────────────────────────────

/**
 * Build a human-readable CLI invocation string from a NextAction.
 *
 * Includes positional args and a small subset of options that help the user
 * understand the suggested command.  Machine-only options (e.g. `agent: true`)
 * are excluded because they are not useful in a human-mode hint.
 */
/** Convert camelCase option keys to CLI-style kebab-case (e.g. showRecoveryPhrase → show-recovery-phrase). */
function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function buildNextActionCommand(
  action: NextAction,
  options: { includeAgent: boolean },
): string {
  const parts = ["privacy-pools", action.command];

  if (action.args) {
    parts.push(...action.args);
  }

  if (action.options) {
    for (const [key, value] of Object.entries(action.options)) {
      if (key === "agent") {
        if (options.includeAgent && value === true) {
          parts.push("--agent");
        }
        continue;
      }
      if (value === null || value === undefined) continue;
      const flag = camelToKebab(key);
      if (typeof value === "boolean") {
        parts.push(value ? `--${flag}` : `--no-${flag}`);
      } else {
        parts.push(`--${flag}`, String(value));
      }
    }
  }

  return parts.join(" ");
}

export function formatNextActionCommand(action: NextAction): string {
  return buildNextActionCommand(action, { includeAgent: false });
}

export function formatExecutableNextActionCommand(action: NextAction): string {
  return buildNextActionCommand(action, { includeAgent: true });
}

function withCliCommand(action: NextAction): NextAction {
  return action.cliCommand
    ? action
    : { ...action, cliCommand: formatExecutableNextActionCommand(action) };
}

/**
 * Render human-visible next-step guidance derived from the same NextAction
 * array used for JSON `nextActions`.
 *
 * Single source of truth: JSON renderers call `appendNextActions(payload, actions)`,
 * human renderers call `renderNextSteps(ctx, actions)` with the same array.
 *
 * Output goes to stderr, suppressed by --quiet / --agent / --json / --csv.
 */
export function renderNextSteps(
  ctx: OutputContext,
  nextActions: NextAction[] | undefined,
): void {
  if (!nextActions || nextActions.length === 0) return;
  if (isSilent(ctx)) return;

  // Only show fully-specified commands to humans.  Template actions
  // (runnable: false) are for agents — humans shouldn't see a
  // half-formed command that errors when copy-pasted.
  const runnable = nextActions.filter((a) => a.runnable !== false);
  if (runnable.length === 0) return;

  process.stderr.write(
    formatSectionHeading("Next steps", { divider: true, tone: "muted" }),
  );
  for (const action of runnable) {
    const cmd = formatNextActionCommand(action);
    process.stderr.write(`  ${accent(cmd)}\n`);
    process.stderr.write(`    ${chalk.dim(action.reason)}\n`);
  }
}
