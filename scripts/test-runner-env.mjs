import {
  isAllowedRunnerEnvKey,
  RUNNER_ENV_STRIPPED_PREFIXES,
} from "./lib/env-allowlist.mjs";

export function buildTestRunnerEnv(
  overrides = {},
  baseEnv = process.env,
) {
  const env = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const isStrippedPrefix = RUNNER_ENV_STRIPPED_PREFIXES.some((prefix) =>
      key.startsWith(prefix),
    );
    if (isStrippedPrefix && !isAllowedRunnerEnvKey(key)) continue;
    env[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}
