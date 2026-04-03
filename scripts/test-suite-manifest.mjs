export const SHARED_TEST_TARGETS = [
  "./test/acceptance",
  "./test/unit",
  "./test/integration",
  "./test/fuzz",
  "./test/services",
];

export const DEFAULT_MAIN_TEST_TARGETS = SHARED_TEST_TARGETS;

export const DEFAULT_MAIN_BATCHES = [
  { label: "acceptance", targets: ["./test/acceptance"] },
  { label: "unit", targets: ["./test/unit"], batchSize: 10 },
  { label: "integration", targets: ["./test/integration"] },
  { label: "fuzz", targets: ["./test/fuzz"] },
  { label: "services", targets: ["./test/services"] },
];

export const COVERAGE_MAIN_TEST_TARGETS = [
  "./test/unit",
  "./test/services",
];

export const PACKAGED_SMOKE_TEST =
  "./test/integration/cli.packaged-smoke.integration.test.ts";
export const NATIVE_PACKAGE_SMOKE_TEST =
  "./test/integration/cli-native-package-smoke.integration.test.ts";
export const NATIVE_SHELL_SMOKE_TEST =
  "./test/integration/cli-native-shell.integration.test.ts";
export const BUILT_ENTRYPOINT_TEST =
  "./test/integration/cli-built-entrypoint.integration.test.ts";
export const FLOW_INTEGRATION_TEST =
  "./test/integration/cli-flow.integration.test.ts";
export const WORKFLOW_ANVIL_SERVICE_TEST =
  "./test/services/workflow.anvil.service.test.ts";
export const CLI_ANVIL_E2E_TEST =
  "./test/integration/cli-anvil-e2e.integration.test.ts";
export const CLI_ANVIL_FLOW_NEW_WALLET_ERC20_TEST =
  "./test/integration/cli-anvil-flow-new-wallet-erc20.integration.test.ts";
export const CLI_ANVIL_FLOW_NEW_WALLET_USDC_TEST =
  "./test/integration/cli-anvil-flow-new-wallet-usdc.integration.test.ts";
export const CONTRACTS_SERVICE_TEST = "./test/services/contracts.service.test.ts";
export const PROOFS_SERVICE_TEST = "./test/services/proofs.service.test.ts";
export const WORKFLOW_MOCKED_TEST =
  "./test/services/workflow.mocked.service.test.ts";
export const WORKFLOW_SERVICE_TEST =
  "./test/services/workflow.service.test.ts";
export const WORKFLOW_INTERNAL_TEST =
  "./test/services/workflow.internal.service.test.ts";
export const WORKFLOW_BACKUP_PATHS_TEST =
  "./test/services/workflow.backup-paths.service.test.ts";
export const WORKFLOW_BACKUP_WRITE_TEST =
  "./test/services/workflow.backup-write.service.test.ts";
export const ACCOUNT_SYNC_META_TEST =
  "./test/services/account-sync-meta.service.test.ts";
export const FLOW_HANDLERS_TEST = "./test/unit/flow-handlers.unit.test.ts";
export const ACCOUNT_HANDLER_ERRORS_TEST =
  "./test/unit/account-handler-errors.unit.test.ts";
export const ACCOUNTS_READONLY_TEST =
  "./test/unit/accounts-command-readonly.unit.test.ts";
export const HISTORY_READONLY_TEST =
  "./test/unit/history-command-readonly.unit.test.ts";
export const SYNC_READONLY_TEST =
  "./test/unit/sync-command-readonly.unit.test.ts";
export const MIGRATE_STATUS_READONLY_TEST =
  "./test/unit/migrate-status-command-readonly.unit.test.ts";
export const BOOTSTRAP_RUNTIME_TEST =
  "./test/unit/bootstrap-runtime.unit.test.ts";
export const LAUNCHER_RUNTIME_TEST =
  "./test/unit/launcher-runtime.unit.test.ts";
export const INIT_INTERACTIVE_CANCEL_INVALID_TEST =
  "./test/unit/init-command-interactive.cancel-invalid.unit.test.ts";
export const INIT_INTERACTIVE_GENERATE_BACKUP_TEST =
  "./test/unit/init-command-interactive.generate-backup.unit.test.ts";
export const INIT_INTERACTIVE_IMPORT_VISIBLE_SECRET_TEST =
  "./test/unit/init-command-interactive.import-visible-secret.unit.test.ts";
export const INIT_COMMAND_HANDLER_TEST =
  "./test/unit/init-command-handler.unit.test.ts";
export const DEPOSIT_HANDLER_TEST =
  "./test/unit/deposit-command-handler.unit.test.ts";
export const POOLS_HANDLER_TEST =
  "./test/unit/pools-command-handler.unit.test.ts";
export const RAGEQUIT_HANDLER_ENTRY_SUBMIT_TEST =
  "./test/unit/ragequit-command-handler.entry-submit.unit.test.ts";
export const RAGEQUIT_HANDLER_UNSIGNED_TEST =
  "./test/unit/ragequit-command-handler.unsigned.unit.test.ts";
export const RAGEQUIT_HANDLER_OWNERSHIP_TEST =
  "./test/unit/ragequit-command-handler.ownership.unit.test.ts";
export const RAGEQUIT_HANDLER_HUMAN_CONFIRMATION_TEST =
  "./test/unit/ragequit-command-handler.human-confirmation.unit.test.ts";

export const ACCOUNT_READONLY_TESTS = [
  ACCOUNTS_READONLY_TEST,
  HISTORY_READONLY_TEST,
  SYNC_READONLY_TEST,
  MIGRATE_STATUS_READONLY_TEST,
];

export const INIT_INTERACTIVE_TESTS = [
  INIT_INTERACTIVE_CANCEL_INVALID_TEST,
  INIT_INTERACTIVE_GENERATE_BACKUP_TEST,
  INIT_INTERACTIVE_IMPORT_VISIBLE_SECRET_TEST,
];

export const RAGEQUIT_HANDLER_TESTS = [
  RAGEQUIT_HANDLER_ENTRY_SUBMIT_TEST,
  RAGEQUIT_HANDLER_UNSIGNED_TEST,
  RAGEQUIT_HANDLER_OWNERSHIP_TEST,
  RAGEQUIT_HANDLER_HUMAN_CONFIRMATION_TEST,
];

export const COMMAND_SURFACE_TESTS = [
  "./test/conformance/command-metadata.conformance.test.ts",
  "./test/conformance/completion-spec.conformance.test.ts",
  "./test/conformance/lazy-startup.conformance.test.ts",
  "./test/conformance/root-help-static.conformance.test.ts",
];

export const COVERAGE_BEHAVIOR_TESTS = [
  "./test/acceptance/status-init.acceptance.test.ts",
  "./test/acceptance/transaction-inputs.acceptance.test.ts",
  "./test/acceptance/withdraw-quote.acceptance.test.ts",
  "./test/acceptance/no-sync.acceptance.test.ts",
  "./test/integration/cli-built-legacy-restore.integration.test.ts",
];

export const COVERAGE_SIGNAL_TESTS = [
  ...COMMAND_SURFACE_TESTS,
  ...COVERAGE_BEHAVIOR_TESTS,
];

export const ANVIL_E2E_TESTS = [
  WORKFLOW_ANVIL_SERVICE_TEST,
  CLI_ANVIL_E2E_TEST,
  CLI_ANVIL_FLOW_NEW_WALLET_ERC20_TEST,
  CLI_ANVIL_FLOW_NEW_WALLET_USDC_TEST,
];

export const ISOLATED_SUITES = [
  {
    label: "contracts-service",
    tests: [CONTRACTS_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "bun still reuses mocked wallet and sdk modules from this suite across later imports under the shared module cache",
  },
  {
    label: "proofs-service",
    tests: [PROOFS_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks snarkjs and circuit provisioning modules across the proof stack",
  },
  {
    label: "workflow-mocked",
    tests: [WORKFLOW_MOCKED_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "installs a broad workflow mock graph spanning prompts, relayer, contracts, and sdk services",
  },
  {
    label: "workflow-service",
    tests: [WORKFLOW_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "coverage instrumentation still makes the large workflow service suite memory-heavy",
  },
  {
    label: "workflow-internal",
    tests: [WORKFLOW_INTERNAL_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "installs deep workflow-internal mocks that still collide under Bun's shared module state",
  },
  {
    label: "workflow-backup-paths",
    tests: [WORKFLOW_BACKUP_PATHS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks node:fs before importing workflow helpers, which must stay in its own Bun process to avoid cross-suite module pollution",
  },
  {
    label: "workflow-backup-write",
    tests: [WORKFLOW_BACKUP_WRITE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks config persistence before importing workflow helpers, which must stay isolated from other workflow helper suites",
  },
  {
    label: "account-handler-errors",
    tests: [ACCOUNT_HANDLER_ERRORS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: false,
    reason:
      "self-cleaning restore snapshots now return output/common and account modules to their real exports between tests",
  },
  {
    label: "accounts-readonly-coverage",
    tests: [ACCOUNTS_READONLY_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "the accounts read-only slice stays deterministic when coverage runs in its own Bun process",
  },
  {
    label: "sync-readonly-coverage",
    tests: [SYNC_READONLY_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "the sync read-only slice stays deterministic when coverage runs in its own Bun process",
  },
  {
    label: "migrate-status-readonly-coverage",
    tests: [MIGRATE_STATUS_READONLY_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "the migrate-status read-only slice stays deterministic when coverage runs in its own Bun process",
  },
  {
    label: "init-interactive-cancel-invalid",
    tests: [INIT_INTERACTIVE_CANCEL_INVALID_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "replaces the prompt module globally and must stay isolated from other prompt-driven suites",
  },
  {
    label: "init-interactive-generate-backup",
    tests: [INIT_INTERACTIVE_GENERATE_BACKUP_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "prompt-driven generate-and-backup flows must stay isolated from other init tests",
  },
  {
    label: "init-interactive-import-visible-secret",
    tests: [INIT_INTERACTIVE_IMPORT_VISIBLE_SECRET_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "prompt-driven import flows and visible-secret warnings must stay isolated from other init tests",
  },
  {
    label: "init-command-handler",
    tests: [INIT_COMMAND_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov stays stable for the stateful init handler only when coverage runs through a non-tty child process",
  },
  {
    label: "deposit-handler",
    tests: [DEPOSIT_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: false,
    reason:
      "command-handler mocks now restore shared sdk, preflight, and transaction helpers to real export snapshots",
  },
  {
    label: "ragequit-handler-entry-submit-coverage",
    tests: [RAGEQUIT_HANDLER_ENTRY_SUBMIT_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "the entry-selection and signed-submit ragequit slice stays deterministic when coverage runs in its own Bun process",
  },
  {
    label: "ragequit-handler-unsigned-coverage",
    tests: [RAGEQUIT_HANDLER_UNSIGNED_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "the unsigned ragequit slice stays deterministic when coverage runs in its own Bun process",
  },
  {
    label: "ragequit-handler-ownership-coverage",
    tests: [RAGEQUIT_HANDLER_OWNERSHIP_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "the ragequit ownership and selection-error slice stays deterministic when coverage runs in its own Bun process",
  },
  {
    label: "ragequit-handler-human-confirmation-coverage",
    tests: [RAGEQUIT_HANDLER_HUMAN_CONFIRMATION_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "the human-confirmation ragequit slice stays deterministic when coverage runs in its own Bun process",
  },
  {
    label: "pools-handler",
    tests: [POOLS_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: false,
    reason:
      "pools handler restores shared sdk, account, asp, and pool-account modules after each test batch",
  },
  {
    label: "flow-handlers",
    tests: [FLOW_HANDLERS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: false,
    reason:
      "flow handler mocks restore workflow and output modules to captured real export snapshots between tests",
  },
  {
    label: "bootstrap-runtime",
    tests: [BOOTSTRAP_RUNTIME_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mock.module() interception of cli-main transitive imports is not safely reversible in-process across Bun versions",
  },
  {
    label: "launcher-runtime",
    tests: [LAUNCHER_RUNTIME_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun's lcov writer is deterministic for the launcher/runtime source suite only when it runs in its own coverage process",
  },
];

export const DEFAULT_TEST_ISOLATED_SUITES = ISOLATED_SUITES.filter(
  (suite) => suite.isolateInDefaultTest,
);

export const COVERAGE_ISOLATED_SUITES = ISOLATED_SUITES.filter(
  (suite) => suite.isolateInCoverage,
);

export const DEFAULT_MAIN_EXCLUDED_TESTS = [
  PACKAGED_SMOKE_TEST,
  NATIVE_PACKAGE_SMOKE_TEST,
  NATIVE_SHELL_SMOKE_TEST,
  ...ANVIL_E2E_TESTS,
  ...DEFAULT_TEST_ISOLATED_SUITES.flatMap((suite) => suite.tests),
];

export const COVERAGE_MAIN_EXCLUDED_TESTS = [
  ...ANVIL_E2E_TESTS,
  ...COVERAGE_ISOLATED_SUITES.flatMap((suite) => suite.tests),
  "./test/unit/launcher-routing.unit.test.ts",
];
