import { AGENT_ENV_VAR_NAMES } from "../../src/utils/detect-agent.ts";

const STRIPPED_PREFIXES = ["PRIVACY_POOLS_", "PP_"] as const;
const STRIPPED_ENV_VARS = new Set<string>(AGENT_ENV_VAR_NAMES);

export function buildChildProcessEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (STRIPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (STRIPPED_ENV_VARS.has(key)) continue;
    env[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  // Test subprocesses should never inherit forced-color knobs from the parent
  // runner because Node warns when NO_COLOR and FORCE_COLOR collide, and our
  // parity suites compare exact stderr output.
  delete env.FORCE_COLOR;
  delete env.CLICOLOR_FORCE;
  env.NODE_NO_WARNINGS = "1";

  return env;
}
