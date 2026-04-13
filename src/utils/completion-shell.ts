export const SUPPORTED_COMPLETION_SHELLS = [
  "bash",
  "zsh",
  "fish",
  "powershell",
] as const;

export type CompletionShell = (typeof SUPPORTED_COMPLETION_SHELLS)[number];

export function isCompletionShell(value: string): value is CompletionShell {
  return (SUPPORTED_COMPLETION_SHELLS as readonly string[]).includes(value);
}

export function detectCompletionShell(
  envShell: string | undefined = process.env.SHELL,
  platform: NodeJS.Platform = process.platform,
): CompletionShell {
  const raw = (envShell ?? "").toLowerCase();
  if (raw.includes("zsh")) return "zsh";
  if (raw.includes("fish")) return "fish";
  if (raw.includes("pwsh") || raw.includes("powershell")) return "powershell";
  if (raw.includes("bash")) return "bash";
  if (platform === "win32") return "powershell";
  return "bash";
}
