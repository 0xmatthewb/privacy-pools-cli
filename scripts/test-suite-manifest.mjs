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
export const ACCOUNT_SYNC_META_TEST =
  "./test/services/account-sync-meta.service.test.ts";
export const FLOW_HANDLERS_TEST = "./test/unit/flow-handlers.unit.test.ts";
export const ACCOUNT_HANDLER_ERRORS_TEST =
  "./test/unit/account-handler-errors.unit.test.ts";
export const ACCOUNT_READONLY_HANDLERS_TEST =
  "./test/unit/account-readonly-command-handlers.unit.test.ts";
export const BOOTSTRAP_RUNTIME_TEST =
  "./test/unit/bootstrap-runtime.unit.test.ts";
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
    label: "account-handler-errors",
    tests: [ACCOUNT_HANDLER_ERRORS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "even with per-test restore, Bun still reuses mocked output/common and account modules across later imports in the shared main batch",
  },
  {
    label: "account-readonly-handlers",
    tests: [ACCOUNT_READONLY_HANDLERS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks shared account, sdk, pools, and migration modules that still leak under Bun's shared module cache",
  },
  {
    label: "init-interactive",
    tests: [INIT_INTERACTIVE_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "replaces the prompt module globally and still collides with other prompt-driven suites",
  },
  {
    label: "deposit-handler",
    tests: [DEPOSIT_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks shared deposit dependencies across account, contracts, and viem modules",
  },
  {
    label: "withdraw-handler",
    tests: [WITHDRAW_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks shared withdraw dependencies across prompts, proofs, relayer, and contracts modules",
  },
  {
    label: "ragequit-handler",
    tests: [RAGEQUIT_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks shared ragequit dependencies across proofs, contracts, and account modules",
  },
  {
    label: "pools-handler",
    tests: [POOLS_HANDLER_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "mocks shared pool discovery and wallet-state modules that still overlap with other read-only handlers",
  },
  {
    label: "flow-handlers",
    tests: [FLOW_HANDLERS_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "even with per-test restore, Bun still reuses mocked workflow and output modules across later shared-batch imports",
  },
  {
    label: "bootstrap-runtime",
    tests: [BOOTSTRAP_RUNTIME_TEST],
    timeoutMs: 120_000,
    isolateInDefaultTest: true,
    isolateInCoverage: true,
    reason:
      "index and cli bootstrap tests still leak mocked help, static-discovery, and cli-main modules across later imports under Bun's shared module cache",
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
  ...ANVIL_E2E_TESTS,
  ...DEFAULT_TEST_ISOLATED_SUITES.flatMap((suite) => suite.tests),
];

export const COVERAGE_MAIN_EXCLUDED_TESTS = [
  ...ANVIL_E2E_TESTS,
  ...COVERAGE_ISOLATED_SUITES.flatMap((suite) => suite.tests),
];
