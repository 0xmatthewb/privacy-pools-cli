import type { GlobalOptions } from "../types.js";

export interface ParsedStaticCommand {
  command: "guide" | "capabilities" | "describe";
  commandTokens: string[];
  globalOpts: GlobalOptions;
}

export interface ParsedStaticCompletionQuery {
  globalOpts: GlobalOptions;
  shell: "bash" | "zsh" | "fish" | "powershell";
  cword: number | undefined;
  words: string[];
}
