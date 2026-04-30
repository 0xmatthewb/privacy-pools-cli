import {
  matchesTagFilters,
  normalizeTags,
} from "./lib/suite-plan-utils.mjs";
import { getSuiteRuntimeBudget } from "./test-runtime-metadata.mjs";

function makeTags(...tags) {
  return normalizeTags(tags);
}

function defineMainBatch(batch) {
  return {
    tags: makeTags("main", batch.label, ...(batch.tags ?? [])),
    budgetMs: batch.budgetMs ?? null,
    ...batch,
  };
}

function defineTaggedSuite(suite, defaultTags = []) {
  return {
    fixtureClass: suite.fixtureClass ?? suite.label,
    tags: makeTags(...defaultTags, suite.label, ...(suite.tags ?? [])),
    budgetMs: suite.budgetMs ?? getSuiteRuntimeBudget(suite.label),
    ...suite,
  };
}

function defineIsolatedSuite(suite) {
  return defineTaggedSuite(suite, ["isolated"]);
}

function defineOnDemandSuite(suite) {
  return defineTaggedSuite(suite, ["ondemand"]);
}

function defineQuarantinedSuite(suite) {
  return defineTaggedSuite(suite, ["quarantined"]);
}

export function suiteMatchesTags(
  suite,
  includeTags = [],
  excludeTags = [],
) {
  return matchesTagFilters(suite.tags, includeTags, excludeTags);
}

export const SHARED_TEST_TARGETS = [
  "./test/acceptance",
  "./test/unit",
  "./test/integration",
  "./test/fuzz",
  "./test/services",
];

export const DEFAULT_MAIN_TEST_TARGETS = SHARED_TEST_TARGETS;

export const DEFAULT_MAIN_BATCHES = [
  defineMainBatch({
    label: "acceptance",
    targets: ["./test/acceptance"],
    tags: ["acceptance", "cli-contract"],
    fixtureClass: "subprocess-boundary",
  }),
  defineMainBatch({
    label: "unit",
    targets: ["./test/unit"],
    batchSize: 10,
    tags: ["unit", "fast"],
  }),
  defineMainBatch({
    label: "integration",
    targets: ["./test/integration"],
    tags: ["integration", "boundary"],
    fixtureClass: "subprocess-boundary",
  }),
  defineMainBatch({
    label: "fuzz",
    targets: ["./test/fuzz"],
    tags: ["fuzz", "machine-safety"],
  }),
  defineMainBatch({
    label: "services",
    targets: ["./test/services"],
    tags: ["services", "in-process"],
  }),
];

export const COVERAGE_MAIN_TEST_TARGETS = [
  "./test/unit",
  "./test/services",
];

export const PACKAGED_SMOKE_TEST =
  "./test/integration/cli-packaged-smoke.integration.test.ts";
export const PACKED_SMOKE_TEST = PACKAGED_SMOKE_TEST;
export const NATIVE_PACKAGE_SMOKE_TEST =
  "./test/integration/cli-native-package-smoke.integration.test.ts";
export const NATIVE_MACHINE_CONTRACT_TEST =
  "./test/integration/cli-native-machine-contract.integration.test.ts";
export const NATIVE_ROUTING_SMOKE_TEST =
  "./test/integration/cli-native-routing-smoke.integration.test.ts";
export const NATIVE_HUMAN_OUTPUT_SMOKE_TEST =
  "./test/integration/cli-native-human-output.integration.test.ts";
export const NATIVE_SHELL_SMOKE_TESTS = [
  NATIVE_MACHINE_CONTRACT_TEST,
  NATIVE_ROUTING_SMOKE_TEST,
  NATIVE_HUMAN_OUTPUT_SMOKE_TEST,
];
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
export const WORKFLOW_MOCKED_TESTS = [
  "./test/services/workflow.mocked.interactive.service.test.ts",
  "./test/services/workflow.mocked.ragequit.service.test.ts",
  "./test/services/workflow.mocked.start.service.test.ts",
  "./test/services/workflow.mocked.watch-lifecycle.service.test.ts",
  "./test/services/workflow.mocked.watch-withdraw.service.test.ts",
];
export const WORKFLOW_SERVICE_TEST =
  "./test/services/workflow.service.test.ts";
export const WORKFLOW_INTERNAL_TEST =
  "./test/services/workflow.internal.service.test.ts";
export const WORKFLOW_BACKUP_PATHS_TEST =
  "./test/services/workflow.backup-paths.service.test.ts";
export const WORKFLOW_BACKUP_WRITE_TEST =
  "./test/services/workflow.backup-write.service.test.ts";
export const WORKFLOW_HELPERS_SERVICE_TEST =
  "./test/services/workflow.helpers.service.test.ts";
export const WORKFLOW_FUNDING_HELPERS_SERVICE_TEST =
  "./test/services/workflow.funding.helpers.service.test.ts";
export const INIT_DISCOVERY_SERVICE_TEST =
  "./test/services/init-discovery.service.test.ts";
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
export const LAUNCHER_ROUTING_TEST =
  "./test/unit/launcher-routing.unit.test.ts";
export const UPGRADE_COMMAND_TEST =
  "./test/unit/upgrade-command.unit.test.ts";
export const INIT_INTERACTIVE_CANCEL_INVALID_TEST =
  "./test/unit/init-command-interactive.cancel-invalid.unit.test.ts";
export const INIT_INTERACTIVE_GENERATE_BACKUP_TEST =
  "./test/unit/init-command-interactive.generate-backup.unit.test.ts";
export const INIT_INTERACTIVE_IMPORT_VISIBLE_SECRET_TEST =
  "./test/unit/init-command-interactive.import-visible-secret.unit.test.ts";
export const INIT_COMMAND_HANDLER_TEST =
  "./test/unit/init-command-handler.unit.test.ts";
export const INIT_COMMAND_HELPERS_TEST =
  "./test/unit/init-command.helpers.unit.test.ts";
export const INIT_COMMAND_INTERACTIVE_HELPERS_TEST =
  "./test/unit/init-command.interactive-helpers.unit.test.ts";
export const DEPOSIT_HANDLER_TEST =
  "./test/unit/deposit-command-handler.unit.test.ts";
export const POOLS_HANDLER_TEST =
  "./test/unit/pools-command-handler.unit.test.ts";
export const RAGEQUIT_COMMAND_HELPERS_TEST =
  "./test/unit/ragequit-command.helpers.unit.test.ts";
export const RAGEQUIT_HANDLER_ENTRY_SUBMIT_TEST =
  "./test/unit/ragequit-command-handler.entry-submit.unit.test.ts";
export const RAGEQUIT_HANDLER_UNSIGNED_TEST =
  "./test/unit/ragequit-command-handler.unsigned.unit.test.ts";
export const RAGEQUIT_HANDLER_OWNERSHIP_TEST =
  "./test/unit/ragequit-command-handler.ownership.unit.test.ts";
export const RAGEQUIT_HANDLER_HUMAN_CONFIRMATION_TEST =
  "./test/unit/ragequit-command-handler.human-confirmation.unit.test.ts";
export const ACCOUNT_HELPERS_SERVICE_TEST =
  "./test/services/account.helpers.service.test.ts";
export const ACCOUNT_SYNC_EVENTS_SERVICE_TEST =
  "./test/services/account.sync-events.service.test.ts";
export const RELAYER_HELPERS_SERVICE_TEST =
  "./test/services/relayer.helpers.service.test.ts";
export const WITHDRAW_COMMAND_HELPERS_TEST =
  "./test/unit/withdraw-command.helpers.unit.test.ts";
export const WITHDRAW_HANDLER_DIRECT_TEST =
  "./test/unit/withdraw-command-handler.direct.unit.test.ts";
export const WITHDRAW_HANDLER_INTERACTIVE_TEST =
  "./test/unit/withdraw-command-handler.interactive.unit.test.ts";
export const WITHDRAW_HANDLER_QUOTE_TEST =
  "./test/unit/withdraw-command-handler.quote.unit.test.ts";
export const WITHDRAW_HANDLER_RELAYED_TEST =
  "./test/unit/withdraw-command-handler.relayed.unit.test.ts";
export const WITHDRAW_HANDLER_VALIDATION_TEST =
  "./test/unit/withdraw-command-handler.validation.unit.test.ts";
export const WITHDRAW_SCENARIOS_TEST =
  "./test/unit/withdraw-scenarios.unit.test.ts";

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

export const WITHDRAW_HANDLER_TESTS = [
  WITHDRAW_HANDLER_DIRECT_TEST,
  WITHDRAW_HANDLER_INTERACTIVE_TEST,
  WITHDRAW_HANDLER_QUOTE_TEST,
  WITHDRAW_HANDLER_RELAYED_TEST,
  WITHDRAW_HANDLER_VALIDATION_TEST,
  WITHDRAW_SCENARIOS_TEST,
];

export const COMMAND_SURFACE_TESTS = [
  "./test/conformance/command-metadata.conformance.test.ts",
  "./test/conformance/completion-spec.conformance.test.ts",
  "./test/conformance/lazy-startup.conformance.test.ts",
];

// Keep source coverage focused on in-process tests that actually instrument
// src/. Subprocess-heavy acceptance and integration suites still run in
// test:ci, but they are behavioral contracts rather than authoritative
// line-coverage signal.
export const COVERAGE_SIGNAL_TESTS = [
  ...COMMAND_SURFACE_TESTS,
];

export const STABLE_SUITE_TAXONOMY = [
  "acceptance",
  "unit",
  "services",
  "integration",
  "conformance",
  "native",
  "install-boundary",
  "anvil",
  "workflow",
  "protocol",
  "fund-moving",
  "expensive",
  "quarantined",
];

export const ANVIL_E2E_TESTS = [
  WORKFLOW_ANVIL_SERVICE_TEST,
  CLI_ANVIL_E2E_TEST,
  CLI_ANVIL_FLOW_NEW_WALLET_ERC20_TEST,
  CLI_ANVIL_FLOW_NEW_WALLET_USDC_TEST,
];

export const ON_DEMAND_TAG_SUITES = [
  defineOnDemandSuite({
    label: "packed-smoke",
    tests: [PACKAGED_SMOKE_TEST],
    timeoutMs: 180_000,
    tags: ["integration", "packed-smoke", "install-boundary", "expensive"],
    fixtureClass: "packaged-install",
  }),
  defineOnDemandSuite({
    label: "native-package-smoke",
    tests: [NATIVE_PACKAGE_SMOKE_TEST],
    timeoutMs: 240_000,
    tags: ["integration", "native", "package", "install-boundary", "expensive"],
    fixtureClass: "native-package",
  }),
  defineOnDemandSuite({
    label: "native-machine-contract-parity",
    tests: [NATIVE_MACHINE_CONTRACT_TEST],
    timeoutMs: 240_000,
    tags: ["integration", "native", "boundary", "machine", "expensive"],
    fixtureClass: "native-boundary",
  }),
  defineOnDemandSuite({
    label: "native-routing-smoke",
    tests: [NATIVE_ROUTING_SMOKE_TEST],
    timeoutMs: 180_000,
    tags: ["integration", "native", "boundary", "routing", "expensive"],
    fixtureClass: "native-boundary",
  }),
  defineOnDemandSuite({
    label: "native-human-output-smoke",
    tests: [NATIVE_HUMAN_OUTPUT_SMOKE_TEST],
    timeoutMs: 180_000,
    tags: ["integration", "native", "boundary", "human-output", "expensive"],
    fixtureClass: "native-boundary",
  }),
  defineOnDemandSuite({
    label: "workflow-anvil-service",
    tests: [WORKFLOW_ANVIL_SERVICE_TEST],
    timeoutMs: 300_000,
    tags: ["services", "anvil", "stateful", "workflow", "expensive"],
    fixtureClass: "anvil",
  }),
  defineOnDemandSuite({
    label: "cli-anvil-e2e",
    tests: [CLI_ANVIL_E2E_TEST],
    timeoutMs: 300_000,
    tags: ["integration", "anvil", "stateful", "fund-moving", "expensive"],
    fixtureClass: "anvil",
  }),
  defineOnDemandSuite({
    label: "cli-anvil-flow-new-wallet-erc20",
    tests: [CLI_ANVIL_FLOW_NEW_WALLET_ERC20_TEST],
    timeoutMs: 300_000,
    tags: ["integration", "anvil", "stateful", "workflow", "fund-moving", "expensive"],
    fixtureClass: "anvil",
  }),
  defineOnDemandSuite({
    label: "cli-anvil-flow-new-wallet-usdc",
    tests: [CLI_ANVIL_FLOW_NEW_WALLET_USDC_TEST],
    timeoutMs: 300_000,
    tags: ["integration", "anvil", "stateful", "workflow", "fund-moving", "expensive"],
    fixtureClass: "anvil",
  }),
];

export const QUARANTINED_SUITES = [
  // Add temporarily quarantined suites here. They stay out of blocking
  // profiles and only run through the informational flake lanes until fixed.
];

export const ISOLATED_SUITES = [
  defineIsolatedSuite({
    label: "contracts-service",
    tests: [CONTRACTS_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "protocol-mocks",
    tags: ["services", "protocol", "sdk", "expensive"],
    reason:
      "bun still reuses mocked wallet and sdk modules from this suite across later imports under the shared module cache",
  }),
  defineIsolatedSuite({
    label: "proofs-service",
    tests: [PROOFS_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "proof-stack",
    tags: ["services", "proofs", "protocol", "expensive"],
    reason:
      "mocks snarkjs and circuit provisioning modules across the proof stack",
  }),
  defineIsolatedSuite({
    label: "workflow-mocked",
    tests: WORKFLOW_MOCKED_TESTS,
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "workflow-mock-graph",
    tags: ["services", "workflow", "expensive"],
    reason:
      "installs a broad workflow mock graph spanning prompts, relayer, contracts, and sdk services",
  }),
  defineIsolatedSuite({
    label: "workflow-service",
    tests: [WORKFLOW_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "workflow-engine",
    tags: ["services", "workflow", "expensive"],
    reason:
      "coverage instrumentation still makes the large workflow service suite memory-heavy",
  }),
  defineIsolatedSuite({
    label: "workflow-helpers-coverage",
    tests: [WORKFLOW_HELPERS_SERVICE_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "workflow-helper-coverage",
    tags: ["services", "workflow", "coverage"],
    reason:
      "the workflow helper suite yields richer lcov maps for helper branches when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "workflow-funding-helpers-coverage",
    tests: [WORKFLOW_FUNDING_HELPERS_SERVICE_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "workflow-funding-helper-coverage",
    tags: ["services", "workflow", "coverage"],
    reason:
      "the workflow funding helper suite installs targeted sdk mocks and yields richer lcov maps when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "workflow-internal",
    tests: [WORKFLOW_INTERNAL_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "workflow-mock-graph",
    tags: ["services", "workflow", "internal", "expensive"],
    reason:
      "installs deep workflow-internal mocks that still collide under Bun's shared module state",
  }),
  defineIsolatedSuite({
    label: "workflow-backup-paths",
    tests: [WORKFLOW_BACKUP_PATHS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "workflow-filesystem",
    tags: ["services", "workflow", "filesystem"],
    reason:
      "mocks node:fs before importing workflow helpers, which must stay in its own Bun process to avoid cross-suite module pollution",
  }),
  defineIsolatedSuite({
    label: "workflow-backup-write",
    tests: [WORKFLOW_BACKUP_WRITE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "workflow-filesystem",
    tags: ["services", "workflow", "filesystem"],
    reason:
      "mocks config persistence before importing workflow helpers, which must stay isolated from other workflow helper suites",
  }),
  defineIsolatedSuite({
    label: "init-discovery-service",
    tests: [INIT_DISCOVERY_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "restore-discovery",
    tags: ["services", "init", "discovery"],
    reason:
      "mocks sdk, pools, account, and account-storage modules to cover restore discovery outcomes and must stay isolated from other service suites",
  }),
  defineIsolatedSuite({
    label: "account-helpers-coverage",
    tests: [ACCOUNT_HELPERS_SERVICE_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "account-helper-coverage",
    tags: ["services", "accounts", "coverage"],
    reason:
      "the account helper suite mocks migration modules for legacy-state branches and must stay isolated in normal and coverage runs",
  }),
  defineIsolatedSuite({
    label: "account-sync-events-coverage",
    tests: [ACCOUNT_SYNC_EVENTS_SERVICE_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "account-sync-events-coverage",
    tags: ["services", "accounts", "coverage"],
    reason:
      "the account sync-events suite yields richer lcov maps for rebuild and persistence branches when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "account-readonly",
    tests: ACCOUNT_READONLY_TESTS,
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "account-readonly",
    tags: ["unit", "accounts", "readonly"],
    reason:
      "the readonly command harness rewires account, sdk, asp, and pool-account modules and must stay in its own Bun process to avoid cross-suite cache pollution",
  }),
  defineIsolatedSuite({
    label: "relayer-helpers-coverage",
    tests: [RELAYER_HELPERS_SERVICE_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "relayer-helper-coverage",
    tags: ["services", "relayer", "coverage"],
    reason:
      "the relayer helper suite yields richer lcov maps for failover and quote-validation branches when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "withdraw-command-helpers-coverage",
    tests: [WITHDRAW_COMMAND_HELPERS_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "withdraw-helper-coverage",
    tags: ["unit", "withdraw", "coverage"],
    reason:
      "the withdraw helper suite yields richer lcov maps for quote-validation branches when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "withdraw-scenarios",
    tests: WITHDRAW_HANDLER_TESTS,
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "withdraw-handler",
    tags: ["unit", "withdraw", "coverage", "fund-moving"],
    reason:
      "the withdraw handler scenario suite installs a broad mock graph and only emits stable lcov when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "init-interactive-cancel-invalid",
    tests: [INIT_INTERACTIVE_CANCEL_INVALID_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "interactive-prompts",
    tags: ["unit", "init", "interactive"],
    reason:
      "replaces the prompt module globally and must stay isolated from other prompt-driven suites",
  }),
  defineIsolatedSuite({
    label: "init-interactive-generate-backup",
    tests: [INIT_INTERACTIVE_GENERATE_BACKUP_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "interactive-prompts",
    tags: ["unit", "init", "interactive"],
    reason:
      "prompt-driven generate-and-backup flows must stay isolated from other init tests",
  }),
  defineIsolatedSuite({
    label: "init-interactive-import-visible-secret",
    tests: [INIT_INTERACTIVE_IMPORT_VISIBLE_SECRET_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "interactive-prompts",
    tags: ["unit", "init", "interactive"],
    reason:
      "prompt-driven import flows and visible-secret warnings must stay isolated from other init tests",
  }),
  defineIsolatedSuite({
    label: "init-command-helpers-coverage",
    tests: [INIT_COMMAND_HELPERS_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "init-helper-filesystem",
    tags: ["unit", "init", "coverage", "filesystem"],
    reason:
      "the init helper suite mutates process env and filesystem permissions while covering rollback and backup-path branches, so it must stay isolated in normal and coverage runs",
  }),
  defineIsolatedSuite({
    label: "init-command-interactive-helpers-coverage",
    tests: [INIT_COMMAND_INTERACTIVE_HELPERS_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "init-interactive-helper-prompts",
    tags: ["unit", "init", "coverage", "interactive"],
    reason:
      "the interactive init helper suite swaps prompt modules and process env, so it must stay isolated in normal and coverage runs",
  }),
  defineIsolatedSuite({
    label: "init-command-handler",
    tests: [INIT_COMMAND_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "init-handler",
    tags: ["unit", "init", "coverage"],
    reason:
      "Bun lcov stays stable for the stateful init handler only when coverage runs through a non-tty child process",
  }),
  defineIsolatedSuite({
    label: "ragequit-command-helpers-coverage",
    tests: [RAGEQUIT_COMMAND_HELPERS_TEST],
    timeoutMs: 120_000,
    budgetMs: 30_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "ragequit-helper-coverage",
    tags: ["unit", "ragequit", "coverage", "fund-moving"],
    reason:
      "the ragequit helper suite patches sdk recovery helpers and stays deterministic when it runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "ragequit-handler-entry-submit-coverage",
    tests: [RAGEQUIT_HANDLER_ENTRY_SUBMIT_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "ragequit-handler",
    tags: ["unit", "ragequit", "coverage", "fund-moving"],
    reason:
      "the entry-selection and signed-submit ragequit slice stays deterministic when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "ragequit-handler-unsigned-coverage",
    tests: [RAGEQUIT_HANDLER_UNSIGNED_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "ragequit-handler",
    tags: ["unit", "ragequit", "coverage", "fund-moving"],
    reason:
      "the unsigned ragequit slice stays deterministic when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "ragequit-handler-ownership-coverage",
    tests: [RAGEQUIT_HANDLER_OWNERSHIP_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "ragequit-handler",
    tags: ["unit", "ragequit", "coverage", "fund-moving"],
    reason:
      "the ragequit ownership and selection-error slice stays deterministic when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "ragequit-handler-human-confirmation-coverage",
    tests: [RAGEQUIT_HANDLER_HUMAN_CONFIRMATION_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "ragequit-handler",
    tags: ["unit", "ragequit", "coverage", "fund-moving"],
    reason:
      "the human-confirmation ragequit slice stays deterministic when coverage runs in its own Bun process",
  }),
  defineIsolatedSuite({
    label: "bootstrap-runtime",
    tests: [BOOTSTRAP_RUNTIME_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "runtime-boundary",
    tags: ["unit", "runtime", "bootstrap"],
    reason:
      "mock.module() interception of cli-main transitive imports is not safely reversible in-process across Bun versions",
  }),
  defineIsolatedSuite({
    label: "launcher-routing",
    tests: [LAUNCHER_ROUTING_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "runtime-boundary",
    tags: ["unit", "runtime", "routing"],
    reason:
      "the launcher routing suite exercises the runtime boundary and should contribute to the coverage signal in its own stable Bun process",
  }),
  defineIsolatedSuite({
    label: "launcher-runtime",
    tests: [LAUNCHER_RUNTIME_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
    fixtureClass: "runtime-boundary",
    tags: ["unit", "runtime", "launcher"],
    reason:
      "Bun's lcov writer is deterministic for the launcher/runtime source suite only when it runs in its own coverage process",
  }),
  defineIsolatedSuite({
    label: "upgrade-command",
    tests: [UPGRADE_COMMAND_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    fixtureClass: "upgrade-mock-graph",
    tags: ["unit", "upgrade"],
    reason:
      "captureModuleExports() over seven modules combined with mock.restore()/mock.module() reinstalls in beforeEach leaks Bun's shared module cache; cumulative pressure across 12 tests OOM-killed linux-core shard 3 on free Ubuntu runners",
  }),
];

export const DEFAULT_TEST_ISOLATED_SUITES = ISOLATED_SUITES.filter(
  (suite) => suite.isolateInDefaultTest,
);

export const COVERAGE_ISOLATED_SUITES = ISOLATED_SUITES.filter(
  (suite) => suite.isolateInCoverage,
);

export const ALL_MANIFEST_SUITES = [
  ...ON_DEMAND_TAG_SUITES,
  ...ISOLATED_SUITES,
  ...QUARANTINED_SUITES,
];

export const DEFAULT_MAIN_EXCLUDED_TESTS = [
  ...ON_DEMAND_TAG_SUITES.flatMap((suite) => suite.tests),
  ...DEFAULT_TEST_ISOLATED_SUITES.flatMap((suite) => suite.tests),
  ...QUARANTINED_SUITES.flatMap((suite) => suite.tests),
];

export const COVERAGE_MAIN_EXCLUDED_TESTS = [
  ...ANVIL_E2E_TESTS,
  ...COVERAGE_ISOLATED_SUITES.flatMap((suite) => suite.tests),
  ...QUARANTINED_SUITES.flatMap((suite) => suite.tests),
];
