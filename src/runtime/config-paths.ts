import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

let _activeProfile: string | undefined;
const ACTIVE_PROFILE_FILE = ".active-profile";

/**
 * Set the active profile name. Call from root argv parsing before any config loading.
 * When set to a non-"default" value, resolveConfigHome() returns `<base>/profiles/<name>/`.
 */
export function setActiveProfile(name: string | undefined): void {
  _activeProfile = name;
}

/** Returns the current active profile name, or undefined for the default profile. */
export function getActiveProfile(): string | undefined {
  return _activeProfile ?? getPersistedActiveProfile();
}

export function resolveBaseConfigHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.PRIVACY_POOLS_HOME?.trim() ||
    env.PRIVACY_POOLS_CONFIG_DIR?.trim() ||
    join(homedir(), ".privacy-pools")
  );
}

export function resolveConfigHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = resolveBaseConfigHome(env);
  const activeProfile = getActiveProfile();
  if (activeProfile && activeProfile !== "default") {
    return join(base, "profiles", activeProfile);
  }

  return base;
}

export function resolveConfigPath(
  segments: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigHome(env), ...segments);
}

export function activeProfileFilePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveBaseConfigHome(env), ACTIVE_PROFILE_FILE);
}

export function getPersistedActiveProfile(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const filePath = activeProfileFilePath(env);
  if (!existsSync(filePath)) return undefined;
  try {
    const value = readFileSync(filePath, "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function persistActiveProfile(
  name: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const base = resolveBaseConfigHome(env);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const filePath = activeProfileFilePath(env);
  writeFileSync(filePath, `${name && name !== "default" ? name : "default"}\n`, {
    mode: 0o600,
  });
  setActiveProfile(name === "default" ? undefined : name);
}
