import { execFile } from "node:child_process";
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
export const BASH_BOOTSTRAP_MANAGED_BLOCK_START =
  "# >>> privacy-pools bash bootstrap >>>";
export const BASH_BOOTSTRAP_MANAGED_BLOCK_END =
  "# <<< privacy-pools bash bootstrap <<<";

export interface CompletionInstallPlan {
  shell: CompletionShell;
  scriptPath: string;
  scriptContent: string;
  profilePath?: string;
  profileContent?: string;
  bootstrapProfilePath?: string;
  bootstrapProfileContent?: string;
  scriptWillCreate: boolean;
  scriptWillUpdate: boolean;
  profileWillCreate: boolean;
  profileWillUpdate: boolean;
  bootstrapProfileWillCreate: boolean;
  bootstrapProfileWillUpdate: boolean;
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
  bootstrapProfilePath?: string;
  bootstrapProfileCreated?: boolean;
  bootstrapProfileUpdated?: boolean;
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

async function resolveBashProfilePath(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  profilePath: string;
  existingProfile: string | null;
  bootstrapProfilePath?: string;
  existingBootstrapProfile: string | null;
}> {
  const home = resolveUserHome(env);
  const bashrc = join(home, ".bashrc");
  const bashProfile = join(home, ".bash_profile");
  const existingBashrc = await readTextIfExists(bashrc);
  const existingBashProfile = await readTextIfExists(bashProfile);
  const bashProfileHasBootstrap = hasManagedBlock(
    existingBashProfile,
    BASH_BOOTSTRAP_MANAGED_BLOCK_START,
    BASH_BOOTSTRAP_MANAGED_BLOCK_END,
  );

  if (existingBashProfile !== null && !bashProfileHasBootstrap) {
    return {
      profilePath: bashProfile,
      existingProfile: existingBashProfile,
      existingBootstrapProfile: null,
    };
  }

  const shouldManageBashrc = existingBashrc !== null || bashProfileHasBootstrap;
  if (shouldManageBashrc) {
    return {
      profilePath: bashrc,
      existingProfile: existingBashrc,
      bootstrapProfilePath: bashProfileHasBootstrap ? bashProfile : undefined,
      existingBootstrapProfile: bashProfileHasBootstrap
        ? existingBashProfile
        : null,
    };
  }

  return {
    profilePath: bashrc,
    existingProfile: null,
    bootstrapProfilePath: bashProfile,
    existingBootstrapProfile: null,
  };
}

function resolveZshProfilePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveUserHome(env), ".zshrc");
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
    return buildManagedBlock(
      COMPLETION_MANAGED_BLOCK_START,
      COMPLETION_MANAGED_BLOCK_END,
      [`[ -f "${escapedPath}" ] && . "${escapedPath}"`],
    );
  }

  if (shell === "zsh") {
    const escapedPath = shellQuoteDouble(scriptPath);
    return buildManagedBlock(
      COMPLETION_MANAGED_BLOCK_START,
      COMPLETION_MANAGED_BLOCK_END,
      [
        "autoload -Uz compinit",
        "if ! typeset -f compdef >/dev/null 2>&1; then",
        "  compinit",
        "fi",
        `[[ -f "${escapedPath}" ]] && source "${escapedPath}"`,
      ],
    );
  }

  const escapedPath = shellQuoteSingle(scriptPath);
  return buildManagedBlock(
    COMPLETION_MANAGED_BLOCK_START,
    COMPLETION_MANAGED_BLOCK_END,
    [
      `if (Test-Path '${escapedPath}') {`,
      `  . '${escapedPath}'`,
      "}",
    ],
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildManagedBlock(
  startMarker: string,
  endMarker: string,
  lines: readonly string[],
): string {
  return [startMarker, ...lines, endMarker].join("\n");
}

function buildManagedBlockPattern(
  startMarker: string,
  endMarker: string,
): RegExp {
  return new RegExp(
    `${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}\\n?`,
    "m",
  );
}

function hasManagedBlock(
  existingContent: string | null,
  startMarker: string,
  endMarker: string,
): boolean {
  return buildManagedBlockPattern(startMarker, endMarker).test(
    normalizeNewlines(existingContent ?? ""),
  );
}

export function applyManagedProfileBlock(
  existingContent: string | null,
  block: string,
): string {
  return applyManagedBlock(
    existingContent,
    block,
    COMPLETION_MANAGED_BLOCK_START,
    COMPLETION_MANAGED_BLOCK_END,
  );
}

function applyManagedBlock(
  existingContent: string | null,
  block: string,
  startMarker: string,
  endMarker: string,
): string {
  const normalizedBlock = ensureTrailingNewline(normalizeNewlines(block));
  const normalizedExisting = normalizeNewlines(existingContent ?? "");
  const blockPattern = buildManagedBlockPattern(startMarker, endMarker);

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

function buildBashBootstrapProfileBlock(bashrcPath: string): string {
  const escapedPath = shellQuoteDouble(bashrcPath);
  return buildManagedBlock(
    BASH_BOOTSTRAP_MANAGED_BLOCK_START,
    BASH_BOOTSTRAP_MANAGED_BLOCK_END,
    [`[ -f "${escapedPath}" ] && . "${escapedPath}"`],
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
  let existingProfile: string | null = null;
  let bootstrapProfilePath: string | undefined;
  let bootstrapProfileContent: string | undefined;
  let existingBootstrapProfile: string | null = null;

  if (shell === "bash") {
    const bashPaths = await resolveBashProfilePath(env);
    profilePath = bashPaths.profilePath;
    existingProfile = bashPaths.existingProfile;
    bootstrapProfilePath = bashPaths.bootstrapProfilePath;
    existingBootstrapProfile = bashPaths.existingBootstrapProfile;
  } else if (shell === "zsh") {
    profilePath = resolveZshProfilePath(env);
  } else if (shell === "powershell") {
    profilePath = await resolvePowerShellProfilePath(env);
  }

  if (profilePath) {
    if (shell !== "bash") {
      existingProfile = await readTextIfExists(profilePath);
    }
    profileContent = applyManagedProfileBlock(
      existingProfile,
      buildManagedProfileBlock(shell as Exclude<CompletionShell, "fish">, scriptPath),
    );
    if (shell === "bash" && bootstrapProfilePath) {
      bootstrapProfileContent = applyManagedBlock(
        existingBootstrapProfile,
        buildBashBootstrapProfileBlock(profilePath),
        BASH_BOOTSTRAP_MANAGED_BLOCK_START,
        BASH_BOOTSTRAP_MANAGED_BLOCK_END,
      );
    }

    return {
      shell,
      scriptPath,
      scriptContent,
      profilePath,
      profileContent,
      bootstrapProfilePath,
      bootstrapProfileContent,
      scriptWillCreate: existingScript === null,
      scriptWillUpdate:
        existingScript !== null &&
        normalizeNewlines(existingScript) !== normalizeNewlines(scriptContent),
      profileWillCreate: existingProfile === null,
      profileWillUpdate:
        existingProfile !== null &&
        normalizeNewlines(existingProfile) !== normalizeNewlines(profileContent),
      bootstrapProfileWillCreate:
        bootstrapProfilePath !== undefined &&
        existingBootstrapProfile === null,
      bootstrapProfileWillUpdate:
        bootstrapProfilePath !== undefined &&
        existingBootstrapProfile !== null &&
        bootstrapProfileContent !== undefined &&
        normalizeNewlines(existingBootstrapProfile) !==
          normalizeNewlines(bootstrapProfileContent),
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
    bootstrapProfileWillCreate: false,
    bootstrapProfileWillUpdate: false,
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

  if (
    plan.bootstrapProfilePath &&
    plan.bootstrapProfileContent &&
    (plan.bootstrapProfileWillCreate || plan.bootstrapProfileWillUpdate)
  ) {
    await mkdir(dirname(plan.bootstrapProfilePath), { recursive: true });
    await writeFile(plan.bootstrapProfilePath, plan.bootstrapProfileContent, "utf8");
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
    ...(plan.bootstrapProfilePath &&
    (plan.bootstrapProfileWillCreate || plan.bootstrapProfileWillUpdate)
      ? {
          bootstrapProfilePath: plan.bootstrapProfilePath,
          bootstrapProfileCreated: plan.bootstrapProfileWillCreate,
          bootstrapProfileUpdated: plan.bootstrapProfileWillUpdate,
        }
      : {}),
    reloadHint: plan.reloadHint,
  };
}

export const completionInstallInternals = {
  applyManagedProfileBlock,
  buildManagedProfileBlock,
  buildBashBootstrapProfileBlock,
  completionScriptPath,
  reloadHintFor,
};
