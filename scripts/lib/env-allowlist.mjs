export const RUNNER_ENV_STRIPPED_PREFIXES = ["PRIVACY_POOLS_", "PP_"];

export const RUNNER_ENV_ALLOWED_EXACT_KEYS = [
  "PP_FLAKE_SEED",
  "PP_KEEP_COVERAGE_ROOT",
  "PP_TEST_BUILT_WORKSPACE_SNAPSHOT",
  "PP_TEST_MAIN_CONCURRENCY",
  "PP_TEST_MAIN_RESPECT_FIXTURE_CLASS",
  "PP_TEST_RUN_ID",
];

export const RUNNER_ENV_ALLOWED_PREFIXES = [
  "PP_ANVIL_",
];

export const RUNNER_ENV_INTERNAL_ONLY_EXACT_KEYS = [
  "PP_KEEP_PREVIEW_AUDIT_ARTIFACTS",
  "PP_NO_UPDATE_CHECK",
  "PP_STRESS_ENABLED",
  "PP_TEST_ISOLATED_CONCURRENCY",
  "PP_TEST_RUNTIME_REPORT_PATH",
];

export const RUNNER_ENV_INTERNAL_ONLY_PREFIXES = [
  "PP_INSTALL_",
  "PP_LOCAL_REGISTRY_",
  "PP_SYNC_RPC_",
  "PP_TEST_AFFECTED_",
];

export function isAllowedRunnerEnvKey(key) {
  return (
    RUNNER_ENV_ALLOWED_EXACT_KEYS.includes(key) ||
    RUNNER_ENV_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function isKnownRunnerEnvKey(key) {
  return (
    isAllowedRunnerEnvKey(key) ||
    RUNNER_ENV_INTERNAL_ONLY_EXACT_KEYS.includes(key) ||
    RUNNER_ENV_INTERNAL_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}
