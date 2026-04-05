import { existsSync } from "node:fs";
import {
  repoNodeModules,
  repoNodeModulesBin,
  STRIPPED_ENV_PREFIXES,
} from "./constants.mjs";

export function ensureNodeModules() {
  if (!existsSync(repoNodeModules)) {
    throw new Error("node_modules not found. Run `npm ci` first.");
  }
}

export function sanitizedProcessEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (STRIPPED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

export function withRepoBinPath(env = {}, { disableNative = true } = {}) {
  return {
    ...sanitizedProcessEnv(),
    PATH: `${repoNodeModulesBin}:${process.env.PATH ?? ""}`,
    PP_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    ...(disableNative ? { PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1" } : {}),
    ...env,
  };
}
