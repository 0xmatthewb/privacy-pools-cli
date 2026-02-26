import type { Command } from "commander";
export declare const SUPPORTED_COMPLETION_SHELLS: readonly ["bash", "zsh", "fish"];
export type CompletionShell = (typeof SUPPORTED_COMPLETION_SHELLS)[number];
export declare function isCompletionShell(value: string): value is CompletionShell;
export declare function detectCompletionShell(envShell?: string | undefined): CompletionShell;
export declare function queryCompletionCandidates(rootCommand: Command, wordsInput: string[], cwordInput?: number): string[];
export declare function renderCompletionScript(shell: CompletionShell, commandName?: string): string;
