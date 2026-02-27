/**
 * Output renderer for the `completion` command.
 *
 * `src/commands/completion.ts` delegates output rendering here.
 */
import type { OutputContext } from "./common.js";
/**
 * Render completion script output.
 */
export declare function renderCompletionScript(ctx: OutputContext, shell: string, script: string): void;
/**
 * Render completion query results.
 */
export declare function renderCompletionQuery(ctx: OutputContext, shell: string, cword: number | undefined, candidates: string[]): void;
