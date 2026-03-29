export const SHARED_TEST_TARGETS = [
  "./test/acceptance",
  "./test/unit",
  "./test/integration",
  "./test/fuzz",
  "./test/services",
];

export const DEFAULT_MAIN_TEST_TARGETS = SHARED_TEST_TARGETS;

export const COVERAGE_MAIN_TEST_TARGETS = [
  "./test/unit",
  "./test/services",
];

export const PACKAGED_SMOKE_TEST =
  "./test/integration/cli.packaged-smoke.integration.test.ts";
export const NATIVE_PACKAGE_SMOKE_TEST =
  "./test/integration/cli-native-package-smoke.integration.test.ts";
export const BUILT_ENTRYPOINT_TEST =
  "./test/integration/cli-built-entrypoint.integration.test.ts";
export const STATUS_INIT_INTEGRATION_TEST =
  "./test/integration/cli-status-init.integration.test.ts";
export const MIGRATE_STATUS_INTEGRATION_TEST =
  "./test/integration/cli-migrate-status.integration.test.ts";
export const CONFIG_ROUNDTRIP_INTEGRATION_TEST =
  "./test/integration/cli-config-roundtrip.integration.test.ts";
export const READ_ONLY_SUCCESS_INTEGRATION_TEST =
  "./test/integration/cli-read-only-success.integration.test.ts";
export const OUTPUT_MODE_INTEGRATION_TEST =
  "./test/integration/cli-output-mode.integration.test.ts";
export const MACHINE_MODE_INTEGRATION_TEST =
  "./test/integration/cli-machine-mode.integration.test.ts";
export const WITHDRAW_QUOTE_INTEGRATION_TEST =
  "./test/integration/cli-withdraw-quote.integration.test.ts";
export const MNEMONIC_FILE_INTEGRATION_TEST =
  "./test/integration/cli-mnemonic-file.integration.test.ts";
export const FLOW_INTEGRATION_TEST =
  "./test/integration/cli-flow.integration.test.ts";
export const AGENT_IMPROVEMENTS_INTEGRATION_TEST =
  "./test/integration/cli-agent-improvements.integration.test.ts";
export const JSON_CONTRACT_INTEGRATION_TEST =
  "./test/integration/cli-json-contract.integration.test.ts";
export const COMPLETION_INTEGRATION_TEST =
  "./test/integration/cli-completion.integration.test.ts";
export const STATS_INTEGRATION_TEST =
  "./test/integration/cli-stats.integration.test.ts";
export const ACTIVITY_INTEGRATION_TEST =
  "./test/integration/cli-activity.integration.test.ts";
export const TRANSACTION_INPUTS_INTEGRATION_TEST =
  "./test/integration/cli-transaction-inputs.integration.test.ts";
export const NO_SYNC_INTEGRATION_TEST =
  "./test/integration/cli-no-sync.integration.test.ts";
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
export const ACCOUNT_READONLY_HANDLERS_TEST =
  "./test/unit/account-readonly-command-handlers.unit.test.ts";
export const BOOTSTRAP_RUNTIME_TEST =
  "./test/unit/bootstrap-runtime.unit.test.ts";
export const LAUNCHER_RUNTIME_TEST =
  "./test/unit/launcher-runtime.unit.test.ts";
export const INIT_INTERACTIVE_TEST =
  "./test/unit/init-command-interactive.unit.test.ts";
export const INIT_COMMAND_HANDLER_TEST =
  "./test/unit/init-command-handler.unit.test.ts";
export const DEPOSIT_HANDLER_TEST =
  "./test/unit/deposit-command-handler.unit.test.ts";
export const WITHDRAW_HANDLER_TEST =
  "./test/unit/withdraw-command-handler.unit.test.ts";
export const RAGEQUIT_HANDLER_TEST =
  "./test/unit/ragequit-command-handler.unit.test.ts";
export const POOLS_HANDLER_TEST =
  "./test/unit/pools-command-handler.unit.test.ts";

export const COMMAND_SURFACE_TESTS = [
  "./test/conformance/command-metadata.conformance.test.ts",
  "./test/conformance/completion-spec.conformance.test.ts",
  "./test/conformance/lazy-startup.conformance.test.ts",
  "./test/conformance/root-help-static.conformance.test.ts",
];

export const ANVIL_E2E_TESTS = [
  WORKFLOW_ANVIL_SERVICE_TEST,
  CLI_ANVIL_E2E_TEST,
  CLI_ANVIL_FLOW_NEW_WALLET_ERC20_TEST,
  CLI_ANVIL_FLOW_NEW_WALLET_USDC_TEST,
];

export const ACCEPTANCE_REPLACED_TESTS = [
  STATUS_INIT_INTEGRATION_TEST,
  MIGRATE_STATUS_INTEGRATION_TEST,
  CONFIG_ROUNDTRIP_INTEGRATION_TEST,
  READ_ONLY_SUCCESS_INTEGRATION_TEST,
  OUTPUT_MODE_INTEGRATION_TEST,
  MACHINE_MODE_INTEGRATION_TEST,
  WITHDRAW_QUOTE_INTEGRATION_TEST,
  MNEMONIC_FILE_INTEGRATION_TEST,
  AGENT_IMPROVEMENTS_INTEGRATION_TEST,
  JSON_CONTRACT_INTEGRATION_TEST,
  COMPLETION_INTEGRATION_TEST,
  STATS_INTEGRATION_TEST,
  ACTIVITY_INTEGRATION_TEST,
  TRANSACTION_INPUTS_INTEGRATION_TEST,
  NO_SYNC_INTEGRATION_TEST,
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
    label: "account-readonly-handlers",
    tests: [ACCOUNT_READONLY_HANDLERS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: false,
    reason:
      "shared service and sdk-package mocks are restored to captured real exports after each test batch",
  },
  {
    label: "account-readonly-accounts-coverage",
    tests: [ACCOUNT_READONLY_HANDLERS_TEST],
    coverageArgs: [ACCOUNT_READONLY_HANDLERS_TEST, "-t", "accounts"],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the accounts-only shard of the read-only handler suite",
  },
  {
    label: "account-readonly-sync-coverage",
    tests: [ACCOUNT_READONLY_HANDLERS_TEST],
    coverageArgs: [ACCOUNT_READONLY_HANDLERS_TEST, "-t", "sync"],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the sync-only shard of the read-only handler suite",
  },
  {
    label: "account-readonly-migrate-coverage",
    tests: [ACCOUNT_READONLY_HANDLERS_TEST],
    coverageArgs: [ACCOUNT_READONLY_HANDLERS_TEST, "-t", "migrate"],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the migrate-only shard of the read-only handler suite",
  },
  {
    label: "init-interactive",
    tests: [INIT_INTERACTIVE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: false,
    reason:
      "replaces the prompt module globally and still collides with other prompt-driven suites",
  },
  {
    label: "init-interactive-cancel-and-invalid-coverage",
    tests: [INIT_INTERACTIVE_TEST],
    coverageArgs: [
      INIT_INTERACTIVE_TEST,
      "-t",
      "cancel reinitialization|invalid recovery phrases",
    ],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the init-interactive cancel and invalid-input shard",
  },
  {
    label: "init-interactive-generate-coverage",
    tests: [INIT_INTERACTIVE_TEST],
    coverageArgs: [
      INIT_INTERACTIVE_TEST,
      "-t",
      "generates a wallet interactively|requires humans to confirm|rejects invalid signer keys|refuses to overwrite",
    ],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the init-interactive generate-and-backup shard",
  },
  {
    label: "init-interactive-import-coverage",
    tests: [INIT_INTERACTIVE_TEST],
    coverageArgs: [
      INIT_INTERACTIVE_TEST,
      "-t",
      "imports a valid recovery phrase interactively|warns humans when secrets are supplied",
    ],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the init-interactive import-and-visible-secret-warning shard",
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
    label: "withdraw-handler",
    tests: [WITHDRAW_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: false,
    reason:
      "unsigned, relayer, asp, and pool-account mocks now restore cleanly to real export snapshots between runs",
  },
  {
    label: "ragequit-handler",
    tests: [RAGEQUIT_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: false,
    reason:
      "ragequit handler mocks now restore shared unsigned, sdk, and pool-account modules to real export snapshots",
  },
  {
    label: "ragequit-handler-entry-and-submit-coverage",
    tests: [RAGEQUIT_HANDLER_TEST],
    coverageArgs: [
      RAGEQUIT_HANDLER_TEST,
      "-t",
      "malformed|submits a signed ragequit",
    ],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the entry-validation and signed-submit shard of the ragequit handler suite",
  },
  {
    label: "ragequit-handler-unsigned-coverage",
    tests: [RAGEQUIT_HANDLER_TEST],
    coverageArgs: [RAGEQUIT_HANDLER_TEST, "-t", "unsigned|commitment"],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the unsigned-output shard of the ragequit handler suite",
  },
  {
    label: "ragequit-handler-ownership-coverage",
    tests: [RAGEQUIT_HANDLER_TEST],
    coverageArgs: [RAGEQUIT_HANDLER_TEST, "-t", "signers|original depositor"],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the original-depositor verification shard of the ragequit handler suite",
  },
  {
    label: "ragequit-handler-human-and-confirmation-coverage",
    tests: [RAGEQUIT_HANDLER_TEST],
    coverageArgs: [
      RAGEQUIT_HANDLER_TEST,
      "-t",
      "humans|human|Pool Account|asset|confirmation|reverts|saving local ragequit state fails|recording fails",
    ],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    reason:
      "Bun lcov is stable for the human-selection and confirmation shard of the ragequit handler suite",
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
  ...ACCEPTANCE_REPLACED_TESTS,
  ...ANVIL_E2E_TESTS,
  ...DEFAULT_TEST_ISOLATED_SUITES.flatMap((suite) => suite.tests),
];

export const COVERAGE_MAIN_EXCLUDED_TESTS = [
  ...ANVIL_E2E_TESTS,
  ...COVERAGE_ISOLATED_SUITES.flatMap((suite) => suite.tests),
  ACCOUNT_READONLY_HANDLERS_TEST,
  RAGEQUIT_HANDLER_TEST,
  "./test/unit/launcher-routing.unit.test.ts",
];
