export const SUPPORTED_COMPLETION_SHELLS = [
  "bash",
  "zsh",
  "fish",
  "powershell",
] as const;

export type CompletionShell = (typeof SUPPORTED_COMPLETION_SHELLS)[number];

export const COMPLETION_SHELL_DETECTION_RULES = [
  { shell: "zsh", matchers: ["zsh"] },
  { shell: "fish", matchers: ["fish"] },
  { shell: "powershell", matchers: ["pwsh", "powershell"] },
  { shell: "bash", matchers: ["bash"] },
] as const satisfies readonly {
  shell: CompletionShell;
  matchers: readonly string[];
}[];

export const COMPLETION_SHELL_CONTRACT = {
  supportedShells: [...SUPPORTED_COMPLETION_SHELLS],
  detectionRules: COMPLETION_SHELL_DETECTION_RULES.map((rule) => ({
    shell: rule.shell,
    matchers: [...rule.matchers],
  })),
  windowsFallback: "powershell",
  defaultFallback: "bash",
} as const;

const COMPLETION_SHELL_SET = new Set<string>(SUPPORTED_COMPLETION_SHELLS);

export function isCompletionShell(value: string): value is CompletionShell {
  return COMPLETION_SHELL_SET.has(value);
}

export function detectCompletionShell(
  envShell: string | undefined = process.env.SHELL,
  platform: NodeJS.Platform = process.platform,
): CompletionShell {
  const raw = (envShell ?? "").toLowerCase();
  for (const rule of COMPLETION_SHELL_DETECTION_RULES) {
    if (rule.matchers.some((matcher) => raw.includes(matcher))) {
      return rule.shell;
    }
  }
  return platform === "win32"
    ? COMPLETION_SHELL_CONTRACT.windowsFallback
    : COMPLETION_SHELL_CONTRACT.defaultFallback;
}
