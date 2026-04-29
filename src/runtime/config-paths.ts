import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, parse, resolve } from "node:path";
import type { StatusIssue } from "../output/status.js";
import {
  constants as fsConstants,
  accessSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";

let _activeProfile: string | undefined;
const ACTIVE_PROFILE_FILE = ".active-profile";

type ConfigHomeWritabilityReason =
  | "exists_readonly"
  | "parent_readonly"
  | "parent_missing";

const WRITABILITY_REASON_SEVERITY: Record<ConfigHomeWritabilityReason, number> = {
  exists_readonly: 1,
  parent_readonly: 2,
  parent_missing: 3,
};

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
  const privacyPoolsHome = env.PRIVACY_POOLS_HOME?.trim();
  if (privacyPoolsHome) return privacyPoolsHome;

  const privacyPoolsConfigDir = env.PRIVACY_POOLS_CONFIG_DIR?.trim();
  if (privacyPoolsConfigDir) return privacyPoolsConfigDir;

  const userHome = env.HOME?.trim() || homedir();
  const legacyHome = join(userHome, ".privacy-pools");
  if (existsSync(legacyHome)) return legacyHome;

  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) return join(xdgConfigHome, "privacy-pools");

  return legacyHome;
}

function worstWritabilityReason(
  reasons: ConfigHomeWritabilityReason[],
): ConfigHomeWritabilityReason {
  return reasons.reduce((worst, reason) =>
    WRITABILITY_REASON_SEVERITY[reason] > WRITABILITY_REASON_SEVERITY[worst]
      ? reason
      : worst,
  );
}

function nearestExistingAncestor(path: string): string | null {
  const absolute = normalize(isAbsolute(path) ? path : resolve(path));
  const root = parse(absolute).root;
  let current = dirname(absolute);

  while (current && current !== root && current !== dirname(current)) {
    try {
      if (existsSync(current)) return current;
    } catch {
      return null;
    }
    current = dirname(current);
  }

  return null;
}

function probePathWritability(path: string): ConfigHomeWritabilityReason | null {
  try {
    if (existsSync(path)) {
      try {
        accessSync(path, fsConstants.W_OK);
        return null;
      } catch {
        return "exists_readonly";
      }
    }
  } catch {
    // Fall through to the parent probe; this helper is advisory only.
  }

  const ancestor = nearestExistingAncestor(path);
  if (!ancestor) return "parent_missing";

  try {
    accessSync(ancestor, fsConstants.W_OK);
    return null;
  } catch {
    return "parent_readonly";
  }
}

export function probeConfigHomeWritability(
  env: NodeJS.ProcessEnv = process.env,
): StatusIssue | null {
  const intendedHome = env.PRIVACY_POOLS_HOME?.trim();
  const intendedConfigDir = env.PRIVACY_POOLS_CONFIG_DIR?.trim();
  const intended = intendedHome || intendedConfigDir || null;
  const effective = resolveBaseConfigHome(env);

  // This intentionally avoids creating a probe directory. On macOS,
  // accessSync(W_OK) can still pass when SIP/quarantine later makes mkdirSync
  // fail with EPERM, so init remains the authoritative write check.
  const reasons = [
    ...(intended ? [probePathWritability(intended)] : []),
    probePathWritability(effective),
  ].filter((reason): reason is ConfigHomeWritabilityReason => reason !== null);

  if (reasons.length === 0) return null;

  let message =
    `Config home ${effective} is not writable. ` +
    "Init cannot persist your recovery phrase or signer key.";
  if (intended && intended !== effective) {
    message +=
      ` PRIVACY_POOLS_HOME=${intended} is shadowed by ` +
      `an existing legacy config at ${effective}; remove the legacy directory ` +
      "or set PRIVACY_POOLS_HOME to a writable path.";
  }

  return {
    code: "home_not_writable",
    message,
    affects: ["deposit", "withdraw", "unsigned"],
    reasonCode: worstWritabilityReason(reasons),
  };
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
