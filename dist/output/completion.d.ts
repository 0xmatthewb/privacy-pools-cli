/**
 * Output renderer for the `completion` command.
 *
 * Phase 1 stub – delegates to existing output calls.
 * Phase 2 will move inline output from src/commands/completion.ts here.
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
