const STRIPPED_PREFIXES = ["PRIVACY_POOLS_", "PP_"];
const ALLOWED_EXACT_KEYS = new Set([
  "PP_CONTRACTS_ROOT",
  "PP_FLAKE_SEED",
  "PP_KEEP_COVERAGE_ROOT",
  "PP_TEST_RUN_ID",
]);
const ALLOWED_PREFIXES = ["PP_ANVIL_"];

function isAllowedRunnerKey(key) {
  return (
    ALLOWED_EXACT_KEYS.has(key) ||
    ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function buildTestRunnerEnv(
  overrides = {},
  baseEnv = process.env,
) {
  const env = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const isStrippedPrefix = STRIPPED_PREFIXES.some((prefix) =>
      key.startsWith(prefix),
    );
    if (isStrippedPrefix && !isAllowedRunnerKey(key)) continue;
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
