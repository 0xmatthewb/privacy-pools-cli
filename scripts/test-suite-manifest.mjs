export const SHARED_TEST_TARGETS = [
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
export const BUILT_ENTRYPOINT_TEST =
  "./test/integration/cli-built-entrypoint.integration.test.ts";
export const CONTRACTS_SERVICE_TEST = "./test/services/contracts.service.test.ts";
export const PROOFS_SERVICE_TEST = "./test/services/proofs.service.test.ts";
export const WORKFLOW_MOCKED_TEST =
  "./test/services/workflow.mocked.service.test.ts";
export const WORKFLOW_SERVICE_TEST =
  "./test/services/workflow.service.test.ts";
export const WORKFLOW_INTERNAL_TEST =
  "./test/services/workflow.internal.service.test.ts";
export const ACCOUNT_SYNC_META_TEST =
  "./test/services/account-sync-meta.service.test.ts";
export const FLOW_HANDLERS_TEST = "./test/unit/flow-handlers.unit.test.ts";
export const ACCOUNT_HANDLER_ERRORS_TEST =
  "./test/unit/account-handler-errors.unit.test.ts";
export const ACCOUNT_READONLY_HANDLERS_TEST =
  "./test/unit/account-readonly-command-handlers.unit.test.ts";
export const INIT_INTERACTIVE_TEST =
  "./test/unit/init-command-interactive.unit.test.ts";
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

export const ISOLATED_SUITES = [
  {
    label: "contracts-service",
    tests: [CONTRACTS_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "proofs-service",
    tests: [PROOFS_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "workflow-mocked",
    tests: [WORKFLOW_MOCKED_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "workflow-service",
    tests: [WORKFLOW_SERVICE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: false,
    isolateInCoverage: true,
  },
  {
    label: "workflow-internal",
    tests: [WORKFLOW_INTERNAL_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "account-sync-meta",
    tests: [ACCOUNT_SYNC_META_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "flow-handlers",
    tests: [FLOW_HANDLERS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "account-handler-errors",
    tests: [ACCOUNT_HANDLER_ERRORS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "account-readonly-handlers",
    tests: [ACCOUNT_READONLY_HANDLERS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "init-interactive",
    tests: [INIT_INTERACTIVE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "deposit-handler",
    tests: [DEPOSIT_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "withdraw-handler",
    tests: [WITHDRAW_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "ragequit-handler",
    tests: [RAGEQUIT_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "pools-handler",
    tests: [POOLS_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
  },
  {
    label: "built-entrypoint",
    tests: [BUILT_ENTRYPOINT_TEST],
    timeoutMs: 240_000,
    isolateInDefaultTest: true,
    isolateInCoverage: false,
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
  ...DEFAULT_TEST_ISOLATED_SUITES.flatMap((suite) => suite.tests),
];

export const COVERAGE_MAIN_EXCLUDED_TESTS = COVERAGE_ISOLATED_SUITES.flatMap(
  (suite) => suite.tests,
);
