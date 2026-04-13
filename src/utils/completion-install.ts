import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { CLIError } from "./errors.js";
import { renderCompletionScript } from "./completion.js";
import type { CompletionShell } from "./completion-query.js";
import { resolveBaseConfigHome } from "../runtime/config-paths.js";

const execFileAsync = promisify(execFile);

export const COMPLETION_MANAGED_BLOCK_START = "# >>> privacy-pools completion >>>";
export const COMPLETION_MANAGED_BLOCK_END = "# <<< privacy-pools completion <<<";

export interface CompletionInstallPlan {
  shell: CompletionShell;
  scriptPath: string;
  scriptContent: string;
  profilePath?: string;
  profileContent?: string;
  scriptWillCreate: boolean;
  scriptWillUpdate: boolean;
  profileWillCreate: boolean;
  profileWillUpdate: boolean;
  reloadHint: string;
}

export interface CompletionInstallResult {
  mode: "completion-install";
  shell: CompletionShell;
  scriptPath: string;
  profilePath?: string;
  scriptCreated: boolean;
  scriptUpdated: boolean;
  profileCreated: boolean;
  profileUpdated: boolean;
  reloadHint: string;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function shellQuoteDouble(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1");
}

function shellQuoteSingle(value: string): string {
  return value.replace(/'/g, "''");
}

function resolveUserHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || homedir();
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function completionScriptPath(
  shell: CompletionShell,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (shell === "fish") {
    return join(resolveUserHome(env), ".config", "fish", "completions", "privacy-pools.fish");
  }

  const baseHome = resolveBaseConfigHome(env);
  const filename = shell === "powershell"
    ? "completion.powershell.ps1"
    : `completion.${shell}`;
  return join(baseHome, "shell", filename);
}

async function resolveBashProfilePath(): Promise<string> {
  const home = resolveUserHome();
  const bashrc = join(home, ".bashrc");
  if (existsSync(bashrc)) return bashrc;

  const bashProfile = join(home, ".bash_profile");
  if (existsSync(bashProfile)) return bashProfile;

  return bashrc;
}

function resolveZshProfilePath(): string {
  return join(resolveUserHome(), ".zshrc");
}

async function resolvePowerShellProfilePath(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const commands = ["pwsh", "powershell"];
  const args = [
    "-NoProfile",
    "-Command",
    "$profile = $PROFILE.CurrentUserAllHosts; if ($profile) { [Console]::Out.Write($profile) }",
  ];

  for (const executable of commands) {
    try {
      const { stdout } = await execFileAsync(executable, args, {
        env,
        windowsHide: true,
      });
      const profilePath = stdout.trim();
      if (profilePath.length > 0) {
        return profilePath;
      }
    } catch {
      // Try the next executable.
    }
  }

  throw new CLIError(
    "Could not resolve your PowerShell profile for auto-install.",
    "INPUT",
    "Run 'privacy-pools completion powershell' and add it to your PowerShell profile manually.",
  );
}

function buildManagedProfileBlock(
  shell: Exclude<CompletionShell, "fish">,
  scriptPath: string,
): string {
  if (shell === "bash") {
    const escapedPath = shellQuoteDouble(scriptPath);
    return [
      COMPLETION_MANAGED_BLOCK_START,
      `[ -f "${escapedPath}" ] && . "${escapedPath}"`,
      COMPLETION_MANAGED_BLOCK_END,
    ].join("\n");
  }

  if (shell === "zsh") {
    const escapedPath = shellQuoteDouble(scriptPath);
    return [
      COMPLETION_MANAGED_BLOCK_START,
      "autoload -Uz compinit",
      "if ! typeset -f compdef >/dev/null 2>&1; then",
      "  compinit",
      "fi",
      `[[ -f "${escapedPath}" ]] && source "${escapedPath}"`,
      COMPLETION_MANAGED_BLOCK_END,
    ].join("\n");
  }

  const escapedPath = shellQuoteSingle(scriptPath);
  return [
    COMPLETION_MANAGED_BLOCK_START,
    `if (Test-Path '${escapedPath}') {`,
    `  . '${escapedPath}'`,
    "}",
    COMPLETION_MANAGED_BLOCK_END,
  ].join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyManagedProfileBlock(
  existingContent: string | null,
  block: string,
): string {
  const normalizedBlock = ensureTrailingNewline(normalizeNewlines(block));
  const normalizedExisting = normalizeNewlines(existingContent ?? "");
  const blockPattern = new RegExp(
    `${escapeRegex(COMPLETION_MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegex(COMPLETION_MANAGED_BLOCK_END)}\\n?`,
    "m",
  );

  if (blockPattern.test(normalizedExisting)) {
    return ensureTrailingNewline(
      normalizedExisting.replace(blockPattern, normalizedBlock),
    );
  }

  if (normalizedExisting.trim().length === 0) {
    return normalizedBlock;
  }

  return ensureTrailingNewline(
    `${normalizedExisting.trimEnd()}\n\n${normalizedBlock.trimEnd()}`,
  );
}

function reloadHintFor(
  shell: CompletionShell,
  profilePath: string | undefined,
): string {
  if (shell === "fish") {
    return "Start a new fish shell to load the updated completion file.";
  }

  if (profilePath) {
    if (shell === "powershell") {
      return `Reload your shell profile or run: . '${profilePath.replace(/'/g, "''")}'`;
    }
    return `Reload your shell profile or run: source "${profilePath}"`;
  }

  return "Start a new shell session to load the updated completion file.";
}

export async function buildCompletionInstallPlan(
  shell: CompletionShell,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompletionInstallPlan> {
  const scriptPath = completionScriptPath(shell, env);
  const scriptContent = ensureTrailingNewline(renderCompletionScript(shell));
  const existingScript = await readTextIfExists(scriptPath);

  let profilePath: string | undefined;
  let profileContent: string | undefined;

  if (shell === "bash") {
    profilePath = await resolveBashProfilePath();
  } else if (shell === "zsh") {
    profilePath = resolveZshProfilePath();
  } else if (shell === "powershell") {
    profilePath = await resolvePowerShellProfilePath(env);
  }

  if (profilePath) {
    const existingProfile = await readTextIfExists(profilePath);
    profileContent = applyManagedProfileBlock(
      existingProfile,
      buildManagedProfileBlock(shell as Exclude<CompletionShell, "fish">, scriptPath),
    );
    return {
      shell,
      scriptPath,
      scriptContent,
      profilePath,
      profileContent,
      scriptWillCreate: existingScript === null,
      scriptWillUpdate:
        existingScript !== null &&
        normalizeNewlines(existingScript) !== normalizeNewlines(scriptContent),
      profileWillCreate: existingProfile === null,
      profileWillUpdate:
        existingProfile !== null &&
        normalizeNewlines(existingProfile) !== normalizeNewlines(profileContent),
      reloadHint: reloadHintFor(shell, profilePath),
    };
  }

  return {
    shell,
    scriptPath,
    scriptContent,
    scriptWillCreate: existingScript === null,
    scriptWillUpdate:
      existingScript !== null &&
      normalizeNewlines(existingScript) !== normalizeNewlines(scriptContent),
    profileWillCreate: false,
    profileWillUpdate: false,
    reloadHint: reloadHintFor(shell, undefined),
  };
}

export async function performCompletionInstall(
  plan: CompletionInstallPlan,
): Promise<CompletionInstallResult> {
  await mkdir(dirname(plan.scriptPath), { recursive: true });

  if (plan.scriptWillCreate || plan.scriptWillUpdate) {
    await writeFile(plan.scriptPath, plan.scriptContent, "utf8");
  }

  if (plan.profilePath && plan.profileContent && (plan.profileWillCreate || plan.profileWillUpdate)) {
    await mkdir(dirname(plan.profilePath), { recursive: true });
    await writeFile(plan.profilePath, plan.profileContent, "utf8");
  }

  return {
    mode: "completion-install",
    shell: plan.shell,
    scriptPath: plan.scriptPath,
    profilePath: plan.profilePath,
    scriptCreated: plan.scriptWillCreate,
    scriptUpdated: plan.scriptWillUpdate,
    profileCreated: plan.profileWillCreate,
    profileUpdated: plan.profileWillUpdate,
    reloadHint: plan.reloadHint,
  };
}

export const completionInstallInternals = {
  applyManagedProfileBlock,
  buildManagedProfileBlock,
  completionScriptPath,
  reloadHintFor,
};
