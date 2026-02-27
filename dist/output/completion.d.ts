/**
 * Output renderer for the `completion` command.
 *
 * Wired in Phase 2 – src/commands/completion.ts delegates all output here.
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
