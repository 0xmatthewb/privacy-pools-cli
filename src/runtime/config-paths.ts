import { homedir } from "node:os";
import { join } from "node:path";

let _activeProfile: string | undefined;

/**
 * Set the active profile name. Call from root argv parsing before any config loading.
 * When set to a non-"default" value, resolveConfigHome() returns `<base>/profiles/<name>/`.
 */
export function setActiveProfile(name: string | undefined): void {
  _activeProfile = name;
}

/** Returns the current active profile name, or undefined for the default profile. */
export function getActiveProfile(): string | undefined {
  return _activeProfile;
}

export function resolveConfigHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base =
    env.PRIVACY_POOLS_HOME?.trim() ||
    env.PRIVACY_POOLS_CONFIG_DIR?.trim() ||
    join(homedir(), ".privacy-pools");

  if (_activeProfile && _activeProfile !== "default") {
    return join(base, "profiles", _activeProfile);
  }

  return base;
}

export function resolveConfigPath(
  segments: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigHome(env), ...segments);
}
