/**
 * Output renderer for the `completion` command.
 *
 * Phase 1 stub – delegates to existing output calls.
 * Phase 2 will move inline output from src/commands/completion.ts here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess } from "./common.js";

/**
 * Render completion script output.
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

  if (candidates.length > 0) {
    process.stdout.write(`${candidates.join("\n")}\n`);
  }
}
