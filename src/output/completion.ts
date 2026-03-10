/**
 * Output renderer for the `completion` command.
 *
 * `src/commands/completion.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, guardCsvUnsupported } from "./common.js";

/**
 * Render completion script output.
 *
 * Note: completion scripts must go to stdout (not stderr) so they can be
 * sourced by the shell. This is the only non-JSON command that writes to
 * stdout in human mode.
 */
export function renderCompletionScript(
  ctx: OutputContext,
  shell: string,
  script: string,
): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({
      mode: "completion-script",
      shell,
      completionScript: script,
    });
    return;
  }

  guardCsvUnsupported(ctx, "completion");
  process.stdout.write(script.endsWith("\n") ? script : `${script}\n`);
}

/**
 * Render completion query results.
 */
export function renderCompletionQuery(
  ctx: OutputContext,
  shell: string,
  cword: number | undefined,
  candidates: string[],
): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({
      mode: "completion-query",
      shell,
      cword,
      candidates,
    });
    return;
  }

  guardCsvUnsupported(ctx, "completion");
  if (candidates.length > 0) {
    process.stdout.write(`${candidates.join("\n")}\n`);
  }
}
