import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATED_COMMAND_PATHS,
  GENERATED_COMMAND_ROUTES,
} from "../../src/utils/command-routing-static.ts";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";

export const PREVIEW_OWNERS = ["js", "native", "forwarded"];
export const PREVIEW_RUNTIMES = ["js", "native", "forwarded"];
export const PREVIEW_SOURCES = ["live-command", "renderer-fixture"];
export const PREVIEW_EXECUTION_KINDS = ["live-command", "renderer-fixture"];
export const PREVIEW_MODES = ["captured", "tty"];
export const PREVIEW_VARIANT_IDS = ["rich", "no-color", "ascii", "narrow"];
export const PREVIEW_STATE_CLASSES = [
  "help",
  "ready",
  "empty",
  "degraded",
  "validation-error",
  "operational-error",
  "prompt",
  "progress-step",
  "blocked",
  "terminal",
];
export const PREVIEW_FIDELITIES = [
  "live-command",
  "preview-scenario",
  "renderer-fixture",
  "progress-snapshot",
];
export const PREVIEW_TRUTH_REQUIREMENTS = [
  "live-required",
  "live-preferred",
  "synthetic-allowed",
];

export const FLOW_STATUS_PREVIEW_PHASES = [
  "awaiting_funding",
  "depositing_publicly",
  "awaiting_asp",
  "approved_waiting_privacy_delay",
  "approved_ready_to_withdraw",
  "withdrawing",
  "completed",
  "completed_public_recovery",
  "paused_declined",
  "paused_poi_required",
  "stopped_external",
];

export const PREVIEW_COMMAND_INVENTORY = ["root", ...GENERATED_COMMAND_PATHS];
const HELP_COMMAND_PATHS = [...GENERATED_COMMAND_PATHS];

export const PREVIEW_PROMPT_INVENTORY = [
  { caseId: "init-overwrite-prompt", commandPath: "init", stateId: "overwrite-confirm" },
  { caseId: "init-setup-mode-prompt", commandPath: "init", stateId: "setup-mode" },
  { caseId: "init-import-recovery-prompt", commandPath: "init", stateId: "import-recovery" },
  { caseId: "init-backup-method-prompt", commandPath: "init", stateId: "backup-method" },
  { caseId: "init-backup-path-prompt", commandPath: "init", stateId: "backup-path" },
  { caseId: "init-backup-confirm-prompt", commandPath: "init", stateId: "backup-confirm" },
  { caseId: "init-recovery-verification-prompt", commandPath: "init", stateId: "recovery-verification" },
  { caseId: "init-signer-key-prompt", commandPath: "init", stateId: "signer-key" },
  { caseId: "init-default-chain-prompt", commandPath: "init", stateId: "default-chain" },
  { caseId: "deposit-asset-select-prompt", commandPath: "deposit", stateId: "asset-select" },
  { caseId: "deposit-unique-amount-prompt", commandPath: "deposit", stateId: "unique-amount-confirm" },
  { caseId: "deposit-confirm-prompt", commandPath: "deposit", stateId: "confirm" },
  { caseId: "withdraw-pa-select-prompt", commandPath: "withdraw", stateId: "pool-account-select" },
  { caseId: "withdraw-recipient-prompt", commandPath: "withdraw", stateId: "recipient-input" },
  { caseId: "withdraw-direct-confirm-prompt", commandPath: "withdraw", stateId: "direct-confirm" },
  { caseId: "withdraw-confirm", commandPath: "withdraw", stateId: "relayed-confirm" },
  { caseId: "ragequit-select", commandPath: "ragequit", stateId: "pool-account-select" },
  { caseId: "ragequit-confirm", commandPath: "ragequit", stateId: "confirm" },
  { caseId: "upgrade-confirm-prompt", commandPath: "upgrade", stateId: "install-confirm" },
  { caseId: "flow-start-interactive-prompt", commandPath: "flow start", stateId: "recipient-input" },
  { caseId: "flow-start-confirm-prompt", commandPath: "flow start", stateId: "confirm" },
  {
    caseId: "flow-start-new-wallet-backup-choice",
    commandPath: "flow start",
    stateId: "workflow-wallet-backup-choice",
  },
  {
    caseId: "flow-start-new-wallet-backup-path-prompt",
    commandPath: "flow start",
    stateId: "workflow-wallet-backup-path",
  },
  {
    caseId: "flow-start-new-wallet-backup-confirm",
    commandPath: "flow start",
    stateId: "workflow-wallet-backup-confirm",
  },
];

export const PREVIEW_PROGRESS_INVENTORY = [
  { caseId: "init-progress-restore-discovery", commandPath: "init", progressStep: "init.restore-discovery" },
  { caseId: "status-progress-health-check", commandPath: "status", progressStep: "status.health-check" },
  { caseId: "activity-progress-fetch", commandPath: "activity", progressStep: "activity.fetch" },
  { caseId: "stats-progress-global-fetch", commandPath: "stats", progressStep: "stats.global.fetch" },
  { caseId: "stats-progress-pool-fetch", commandPath: "stats pool", progressStep: "stats.pool.fetch" },
  { caseId: "pools-progress-list-fetch", commandPath: "pools", progressStep: "pools.list.fetch" },
  { caseId: "pools-progress-detail-fetch", commandPath: "pools", progressStep: "pools.detail.fetch" },
  { caseId: "deposit-progress-approve-token", commandPath: "deposit", progressStep: "deposit.approve-token" },
  { caseId: "deposit-progress-submit", commandPath: "deposit", progressStep: "deposit.submit" },
  { caseId: "withdraw-progress-sync-account-state", commandPath: "withdraw", progressStep: "withdraw.sync-account-state" },
  { caseId: "withdraw-progress-request-quote", commandPath: "withdraw", progressStep: "withdraw.request-quote" },
  { caseId: "withdraw-progress-generate-proof", commandPath: "withdraw", progressStep: "withdraw.generate-proof" },
  { caseId: "withdraw-progress-submit-direct", commandPath: "withdraw", progressStep: "withdraw.submit-direct" },
  { caseId: "withdraw-progress-submit-relayed", commandPath: "withdraw", progressStep: "withdraw.submit-relayed" },
  { caseId: "ragequit-progress-load-account", commandPath: "ragequit", progressStep: "ragequit.load-account" },
  { caseId: "ragequit-progress-generate-proof", commandPath: "ragequit", progressStep: "ragequit.generate-proof" },
  { caseId: "ragequit-progress-submit", commandPath: "ragequit", progressStep: "ragequit.submit" },
  { caseId: "upgrade-progress-check", commandPath: "upgrade", progressStep: "upgrade.check" },
  { caseId: "upgrade-progress-install", commandPath: "upgrade", progressStep: "upgrade.install" },
  {
    caseId: "flow-start-progress-submit-deposit",
    commandPath: "flow start",
    progressStep: "flow.start.submit-deposit",
  },
];

export const PREVIEW_NATIVE_ROUTE_INVENTORY = Object.entries(
  GENERATED_COMMAND_ROUTES,
)
  .filter(([, route]) => route.nativeModes.some((mode) => mode !== "help"))
  .map(([commandPath, route]) => ({
    commandPath,
    nativeModes: route.nativeModes.filter((mode) => mode !== "help"),
  }));

export const PREVIEW_COVERAGE_SPEC = {
  commandInventory: PREVIEW_COMMAND_INVENTORY,
  promptInventory: PREVIEW_PROMPT_INVENTORY,
  progressInventory: PREVIEW_PROGRESS_INVENTORY,
  nativeRouteInventory: PREVIEW_NATIVE_ROUTE_INVENTORY,
};

export const PREVIEW_PROGRESS_ALLOWLIST = [
  {
    file: "src/commands/accounts.ts",
    pattern: "spinner(",
    reason:
      "Accounts loading is covered by the audited steady-state account dashboards; the transient loader is intentionally not snapshot-tested yet.",
  },
  {
    file: "src/commands/history.ts",
    pattern: 'spinner("Loading history..."',
    reason:
      "History loading remains a brief local/bootstrap wait and is covered by the richer rendered history states instead of a dedicated spinner snapshot.",
  },
  {
    file: "src/commands/migrate.ts",
    pattern: "formatMigrationLoadingText(",
    reason:
      "Migration readiness loading is short-lived and shares the same read-only fetch pattern as the audited rendered migration states.",
  },
  {
    file: "src/commands/sync.ts",
    pattern: 'spinner("Resolving pools for sync..."',
    reason:
      "Sync is primarily audited through its empty and completion states; the short resolver spinner is allowlisted to avoid redundant transcript noise.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'writeWorkflowNarrativeProgress( ["Approve token", "Submit deposit"], 0',
    reason:
      "Configured-wallet flow deposits reuse the audited deposit progress surfaces, so the internal workflow wrapper stays allowlisted instead of duplicated.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'spinner("Approving token spend..."',
    reason:
      "Configured-wallet flow deposits reuse the audited deposit progress surfaces, so the internal workflow wrapper stays allowlisted instead of duplicated.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'writeWorkflowNarrativeProgress( ["Approve token", "Submit deposit"], 1',
    reason:
      "Flow deposit submission is already covered by the dedicated flow-start deposit progress snapshot.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'spinner("Submitting deposit transaction..."',
    reason:
      "Flow deposit submission is already covered by the dedicated flow-start deposit progress snapshot.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'spinner("Requesting relayer quote..."',
    reason:
      "Flow watch reuses the audited withdraw quote/proof progress stages, so its internal relayer-quote spinner is explicitly allowlisted for now.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: '"Generate and verify withdrawal proof"',
    reason:
      "Flow watch reuses the audited withdraw proof/submission journey, so its internal proof stage remains allowlisted instead of duplicated.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'writeWorkflowNarrativeProgress( ["Generate and verify commitment proof", "Submit public recovery"], 0',
    reason:
      "Workflow ragequit shares the same proof-generation UX as the command-level ragequit flow, which already has dedicated progress coverage.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'spinner("Generating and verifying commitment proof..."',
    reason:
      "Workflow ragequit shares the same proof-generation UX as the command-level ragequit flow, which already has dedicated progress coverage.",
  },
  {
    file: "src/services/workflow.ts",
    pattern: 'writeWorkflowNarrativeProgress( ["Generate and verify commitment proof", "Submit public recovery"], 1',
    reason:
      "Workflow ragequit submission reuses the audited ragequit submission pattern and stays allowlisted to avoid duplicate snapshots.",
  },
  {
    file: "src/services/workflow.ts",
    pattern:
      'writeWorkflowNarrativeProgress( effectiveWatch ? ["Submit deposit", "Watch toward private withdrawal"]',
    reason:
      "Configured-wallet flow start already has dedicated preview progress coverage for the deposit step, so the internal narrative wrapper stays allowlisted.",
  },
  {
    file: "native/shell/src/commands/activity/mod.rs",
    pattern: 'start_spinner("Fetching public activity..."',
    reason:
      "Native activity loading mirrors the JS activity fetch snapshot; the human-facing value is covered once to avoid duplicating equivalent spinners.",
  },
  {
    file: "native/shell/src/commands/stats.rs",
    pattern: "start_spinner(",
    reason:
      "Native stats loading mirrors the JS stats fetch snapshots and remains allowlisted until we add a dedicated native loading matrix.",
  },
];

export const PREVIEW_PROGRESS_CALLSITE_PATTERNS = [
  {
    file: "src/commands/init.ts",
    pattern: 'maybeRenderPreviewProgressStep("init.restore-discovery"',
    progressStep: "init.restore-discovery",
  },
  {
    file: "src/commands/status.ts",
    pattern: "healthCheckLabel",
    progressStep: "status.health-check",
  },
  {
    file: "src/commands/activity.ts",
    pattern: 'spinner("Fetching public activity..."',
    progressStep: "activity.fetch",
  },
  {
    file: "src/commands/stats.ts",
    pattern: 'spinner("Fetching global statistics..."',
    progressStep: "stats.global.fetch",
  },
  {
    file: "src/commands/stats.ts",
    pattern: 'spinner("Fetching pool statistics..."',
    progressStep: "stats.pool.fetch",
  },
  {
    file: "src/commands/pools.ts",
    pattern: "pool details on",
    progressStep: "pools.detail.fetch",
  },
  {
    file: "src/commands/pools.ts",
    pattern: "Fetching pools across chains...",
    progressStep: "pools.list.fetch",
  },
  {
    file: "src/commands/deposit.ts",
    pattern: 'label: "Approving token spend"',
    progressStep: "deposit.approve-token",
  },
  {
    file: "src/commands/deposit.ts",
    pattern: 'spinner("Approving token spend..."',
    progressStep: "deposit.approve-token",
  },
  {
    file: "src/commands/deposit.ts",
    pattern: 'label: "Submitting deposit"',
    progressStep: "deposit.submit",
  },
  {
    file: "src/commands/deposit.ts",
    pattern: 'spinner("Submitting deposit transaction..."',
    progressStep: "deposit.submit",
  },
  {
    file: "src/commands/withdraw.ts",
    pattern: 'label: "Syncing account state"',
    progressStep: "withdraw.sync-account-state",
  },
  {
    file: "src/commands/withdraw.ts",
    pattern: 'spinner("Syncing account state..."',
    progressStep: "withdraw.sync-account-state",
  },
  {
    file: "src/commands/withdraw.ts",
    pattern: '"Requesting relayer quote"',
    progressStep: "withdraw.request-quote",
  },
  {
    file: "src/commands/withdraw.ts",
    pattern: 'spinner("Requesting relayer quote..."',
    progressStep: "withdraw.request-quote",
  },
  {
    file: "src/commands/withdraw.ts",
    pattern: '"Generating and verifying ZK proof"',
    progressStep: "withdraw.generate-proof",
  },
  {
    file: "src/commands/withdraw.ts",
    pattern: '"Submitting withdrawal"',
    progressStep: "withdraw.submit-direct",
  },
  {
    file: "src/commands/withdraw.ts",
    pattern: '"Submitting to relayer"',
    progressStep: "withdraw.submit-relayed",
  },
  {
    file: "src/commands/ragequit.ts",
    pattern: '"Loading account state"',
    progressStep: "ragequit.load-account",
  },
  {
    file: "src/commands/ragequit.ts",
    pattern: 'spinner("Loading account..."',
    progressStep: "ragequit.load-account",
  },
  {
    file: "src/commands/ragequit.ts",
    pattern: '"Generating and verifying commitment proof"',
    progressStep: "ragequit.generate-proof",
  },
  {
    file: "src/commands/ragequit.ts",
    pattern: '"Submitting ragequit"',
    progressStep: "ragequit.submit",
  },
  {
    file: "src/commands/upgrade.ts",
    pattern: 'spinner("Checking for upgrades..."',
    progressStep: "upgrade.check",
  },
  {
    file: "src/commands/upgrade.ts",
    pattern: 'spinner("Installing update..."',
    progressStep: "upgrade.install",
  },
  {
    file: "src/services/workflow.ts",
    pattern: '"Submitting deposit"',
    progressStep: "flow.start.submit-deposit",
  },
];

function clonePreviewModes() {
  return [...PREVIEW_MODES];
}

function inferCommandPath(config) {
  if (config.commandPath) return config.commandPath;
  if (config.surface === "welcome") return "root";
  if (config.surface === "help") {
    return config.id === "root-help"
      ? "root"
      : config.id.replace(/^help-/, "").replace(/-/g, " ");
  }
  if (config.surface === "guide") return "guide";
  if (config.surface === "capabilities") return "capabilities";
  if (config.surface === "describe") return "describe";
  if (config.surface === "completion-script") return "completion";
  if (config.surface === "status") return "status";
  if (config.surface === "accounts") return "accounts";
  if (config.surface === "history") return "history";
  if (config.surface === "sync") return "sync";
  if (config.surface === "migrate") return "migrate status";
  if (config.surface === "deposit") return "deposit";
  if (config.surface === "withdraw") {
    return config.id.includes("quote") ? "withdraw quote" : "withdraw";
  }
  if (config.surface === "ragequit") return "ragequit";
  if (config.surface === "upgrade") return "upgrade";
  if (config.surface === "flow-start") return "flow start";
  if (config.surface === "flow-watch") return "flow watch";
  if (config.surface === "flow-status") return "flow status";
  if (config.surface === "flow-ragequit") return "flow ragequit";
  if (config.surface === "pools") return "pools";
  if (config.surface === "activity") return "activity";
  if (config.surface === "stats") {
    return config.id.includes("stats-pool") ? "stats pool" : "stats";
  }
  if (config.surface === "init" || config.surface === "init-prompt") return "init";
  return config.surface;
}

function inferStateClass(config) {
  if (config.stateClass) return config.stateClass;
  if (config.surface === "help") return "help";
  if (config.executionKind === "renderer-fixture" && config.id.includes("progress")) {
    return "progress-step";
  }
  if (Array.isArray(config.covers) && config.covers.includes("interactive")) {
    return "prompt";
  }
  if (config.id.includes("validation")) return "validation-error";
  if (config.id.includes("error")) return "operational-error";
  if (config.id.includes("empty") || config.id.includes("no-match")) return "empty";
  if (config.id.includes("degraded")) return "degraded";
  if (
    config.id.includes("paused") ||
    config.id.includes("declined") ||
    config.id.includes("poi-required") ||
    config.id.includes("relayer-minimum") ||
    config.id.includes("stopped-external")
  ) {
    return "blocked";
  }
  if (
    config.id.includes("success") ||
    config.id.includes("completed") ||
    config.id.includes("performed") ||
    config.id.includes("no-update")
  ) {
    return "terminal";
  }
  return "ready";
}

function inferInteractive(config) {
  return Array.isArray(config.covers) && config.covers.includes("interactive");
}

function inferTruthRequirement(config) {
  if (config.truthRequirement) return config.truthRequirement;
  if (config.executionKind === "renderer-fixture") {
    return "synthetic-allowed";
  }
  if (config.fidelity === "progress-snapshot") {
    return "synthetic-allowed";
  }
  if (config.fidelity === "preview-scenario") {
    return "live-preferred";
  }
  return "live-required";
}

function createPreviewCase(config) {
  const normalized = {
    expectedExitCodes: [0],
    modes: clonePreviewModes(),
    variantPolicy: [...PREVIEW_VARIANT_IDS],
    interactive: false,
    ...config,
  };
  return {
    ...normalized,
    commandPath: inferCommandPath(normalized),
    stateId: normalized.stateId ?? normalized.id,
    stateClass: inferStateClass(normalized),
    truthRequirement: inferTruthRequirement(normalized),
    interactive:
      typeof normalized.interactive === "boolean"
        ? normalized.interactive
        : inferInteractive(normalized),
    runtimeTarget: normalized.runtimeTarget ?? normalized.runtime,
  };
}

function createLivePreviewCase({
  id,
  label,
  journey,
  surface,
  owner,
  runtime,
  requiredSetup,
  covers,
  syntheticReason,
  modes,
  expectedExitCodes,
  commandLabel,
  needsFixtureServer = false,
  buildInvocation,
  ttyScript,
  requiresTtyScript = false,
  commandPath,
  stateId,
  stateClass,
  variantPolicy,
  fidelity = "live-command",
  interactive = false,
  runtimeTarget = runtime,
  truthRequirement,
}) {
  return createPreviewCase({
    ...(modes ? { modes } : {}),
    ...(expectedExitCodes ? { expectedExitCodes } : {}),
    ...(variantPolicy ? { variantPolicy } : {}),
    id,
    label,
    journey,
    surface,
    owner,
    runtime,
    commandPath,
    stateId,
    stateClass,
    fidelity,
    interactive,
    runtimeTarget,
    ...(truthRequirement ? { truthRequirement } : {}),
    executionKind: "live-command",
    source: "live-command",
    requiredSetup,
    covers,
    ...(syntheticReason ? { syntheticReason } : {}),
    preview: {
      commandLabel,
      needsFixtureServer,
      buildInvocation,
      ttyScript,
      requiresTtyScript,
    },
  });
}

function createRendererFixtureCase({
  id,
  label,
  journey,
  surface,
  owner,
  runtime,
  requiredSetup,
  covers,
  syntheticReason,
  modes,
  expectedExitCodes,
  commandPath,
  stateId,
  stateClass,
  variantPolicy,
  fidelity = "renderer-fixture",
  interactive = false,
  runtimeTarget = runtime,
  truthRequirement,
}) {
  return createPreviewCase({
    ...(modes ? { modes } : {}),
    ...(expectedExitCodes ? { expectedExitCodes } : {}),
    ...(variantPolicy ? { variantPolicy } : {}),
    id,
    label,
    journey,
    surface,
    owner,
    runtime,
    commandPath,
    stateId,
    stateClass,
    fidelity,
    interactive,
    runtimeTarget,
    ...(truthRequirement ? { truthRequirement } : {}),
    executionKind: "renderer-fixture",
    source: "renderer-fixture",
    requiredSetup,
    covers,
    syntheticReason,
    preview: {
      commandLabel: `preview fixture: ${id}`,
      needsFixtureServer: false,
      fixtureCaseId: id,
    },
  });
}

function createFlowStatusCase(phase) {
  const home = createHome(`pp-preview-${phase}-`);
  const phaseCovers = {
    awaiting_funding: ["status", "funding", "wallet"],
    depositing_publicly: ["status", "deposit", "public-deposit"],
    awaiting_asp: ["status", "review", "asp"],
    approved_waiting_privacy_delay: ["status", "privacy-delay", "waiting"],
    approved_ready_to_withdraw: ["status", "ready-to-withdraw", "withdraw"],
    withdrawing: ["status", "withdrawing", "progress"],
    completed: ["status", "completed", "success"],
    completed_public_recovery: ["status", "recovery", "ragequit"],
    paused_declined: ["status", "declined", "recovery"],
    paused_poi_required: ["status", "poi-required", "recovery"],
    stopped_external: ["status", "stopped-external", "accounts"],
  };

  return createLivePreviewCase({
    id: `flow-status-${phase}`,
    label: `flow status | ${phase}`,
    journey: "flow",
    surface: "flow-status",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "flow-snapshot"],
    covers: phaseCovers[phase] ?? ["status", phase],
    commandLabel: "privacy-pools --no-banner flow status latest",
    needsFixtureServer: false,
    buildInvocation: (context) =>
      buildLiveCommandInvocation(context, "forwarded", {
        args: ["--no-banner", "flow", "status", "latest"],
        displayCommand: "privacy-pools --no-banner flow status latest",
        envOverrides: {
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
        },
        prepare: () => {
          writeFlowSnapshot(home, createFlowSnapshotForPhase(phase));
        },
      }),
  });
}

function buildLiveCommandInvocation(context, runtime, options) {
  const { env: launcherEnv, skipReason } = launcherEnvForRuntime(
    runtime,
    context.nativeBinary,
    context.nativeBinaryAvailable,
  );

  if (skipReason) {
    return { skipReason };
  }

  return {
    command: NODE_BIN,
    args: ["--import", "tsx", "src/index.ts", ...options.args],
    displayCommand: options.displayCommand,
    env: buildChildEnv({
      ...launcherEnv,
      ...(options.envOverrides ?? {}),
    }),
    prepare: options.prepare,
  };
}

function createFixtureCase(config) {
  return createRendererFixtureCase({
    ...config,
    syntheticReason:
      config.syntheticReason ??
      "synthetic preview data keeps this layout deterministic without moving funds or mutating local installs",
  });
}

function buildPreviewScenarioInvocation(
  context,
  runtime,
  scenarioId,
  args,
  displayCommand,
  options = {},
) {
  return buildLiveCommandInvocation(context, runtime, {
    args,
    displayCommand,
    envOverrides: {
      PRIVACY_POOLS_CLI_PREVIEW_SCENARIO: scenarioId,
      ...(options.envOverrides ?? {}),
    },
    prepare: options.prepare,
  });
}

function createScenarioPreviewCase({
  id,
  label,
  journey,
  surface,
  owner = "forwarded",
  runtime = "forwarded",
  requiredSetup = [],
  covers,
  args,
  commandLabel,
  syntheticReason,
  modes,
  expectedExitCodes,
  envOverrides,
  prepare,
  buildInvocation,
  ttyScript,
  requiresTtyScript,
  commandPath,
  stateId,
  stateClass,
  variantPolicy,
  interactive = false,
  runtimeTarget = runtime,
  truthRequirement,
}) {
  return createLivePreviewCase({
    id,
    label,
    journey,
    surface,
    owner,
    runtime,
    ...(modes ? { modes } : {}),
    ...(expectedExitCodes ? { expectedExitCodes } : {}),
    ...(variantPolicy ? { variantPolicy } : {}),
    requiredSetup: [...requiredSetup, "preview-scenario"],
    covers,
    commandPath,
    stateId,
    stateClass,
    fidelity: "preview-scenario",
    interactive,
    runtimeTarget,
    ...(truthRequirement ? { truthRequirement } : {}),
    syntheticReason:
      syntheticReason ??
      "preview-only scenario fixture keeps this command deterministic without moving funds or mutating local installs",
    commandLabel,
    buildInvocation: buildInvocation
      ? (context) => buildInvocation(context)
      : (context) =>
        buildPreviewScenarioInvocation(
          context,
          runtime,
          id,
          args,
          commandLabel,
          {
            envOverrides:
              typeof envOverrides === "function"
                ? envOverrides(context)
                : envOverrides,
            prepare:
              typeof prepare === "function"
                ? () => prepare(context)
                : prepare,
          },
        ),
    ttyScript,
    requiresTtyScript,
  });
}

function createProgressPreviewCase({
  id,
  label,
  journey,
  surface,
  owner = "forwarded",
  runtime = "forwarded",
  requiredSetup = [],
  covers,
  args,
  commandLabel,
  progressStep,
  modes,
  envOverrides,
  prepare,
  commandPath,
  stateId,
  buildInvocation,
  needsFixtureServer = false,
  runtimeTarget = runtime,
}) {
  return createLivePreviewCase({
    id,
    label,
    journey,
    surface,
    owner,
    runtime,
    ...(modes ? { modes } : {}),
    requiredSetup,
    covers,
    commandPath,
    stateId,
    stateClass: "progress-step",
    fidelity: "progress-snapshot",
    runtimeTarget,
    syntheticReason:
      "preview progress snapshot exits at a named in-flight step without mutating funds or local state",
    commandLabel,
    needsFixtureServer,
    buildInvocation: buildInvocation
      ? (context) => buildInvocation(context)
      : (context) =>
        buildLiveCommandInvocation(context, runtime, {
          args,
          displayCommand: commandLabel,
          envOverrides: {
            PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP: progressStep,
            ...(typeof envOverrides === "function"
              ? envOverrides(context)
              : envOverrides ?? {}),
          },
          prepare: typeof prepare === "function" ? () => prepare(context) : prepare,
        }),
  });
}

function createPromptScenarioCase(config) {
  return createScenarioPreviewCase({
    modes: ["tty"],
  stateClass: "prompt",
  interactive: true,
  truthRequirement: "live-required",
  ttyScript: {
      steps: [],
      finalPauseMs: 250,
      ...(config.ttyScript ?? {}),
    },
    requiresTtyScript: true,
    ...config,
  });
}

function helpCaseId(commandPath) {
  return `help-${commandPath.replace(/\s+/g, "-")}`;
}

function createCommandHelpPreviewCase(commandPath) {
  const args = [...commandPath.split(" "), "--help"];
  const commandLabel = formatCommand(args);
  return createLivePreviewCase({
    id: helpCaseId(commandPath),
    label: `${commandPath} --help`,
    journey: "onboarding",
    surface: "help",
    owner: "native",
    runtime: "native",
    requiredSetup: ["native-binary"],
    covers: ["help", commandPath],
    commandLabel,
    buildInvocation: (context) =>
      buildLiveCommandInvocation(context, "native", {
        args,
        displayCommand: commandLabel,
      }),
  });
}

function buildCompletionScriptInvocation(context, shell) {
  return buildLiveCommandInvocation(context, "native", {
    args: ["completion", shell],
    displayCommand: `privacy-pools completion ${shell}`,
  });
}

function buildRootHelpInvocation(context) {
  return buildLiveCommandInvocation(context, "native", {
    args: ["--help"],
    displayCommand: "privacy-pools --help",
  });
}

function buildGuideInvocation(context) {
  return buildLiveCommandInvocation(context, "native", {
    args: ["guide"],
    displayCommand: "privacy-pools guide",
  });
}

function buildCapabilitiesInvocation(context) {
  return buildLiveCommandInvocation(context, "native", {
    args: ["--no-banner", "capabilities"],
    displayCommand: "privacy-pools capabilities",
  });
}

function buildDescribeWithdrawQuoteInvocation(context) {
  return buildLiveCommandInvocation(context, "native", {
    args: ["--no-banner", "describe", "withdraw", "quote"],
    displayCommand: "privacy-pools describe withdraw quote",
  });
}

function buildWelcomeBannerInvocation(context) {
  return buildLiveCommandInvocation(context, "js", {
    args: [],
    displayCommand: "privacy-pools",
    envOverrides: {
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
  });
}

function buildReadOnlyFixtureInvocation(context, runtime, commandArgs, displayCommand) {
  return buildLiveCommandInvocation(context, runtime, {
    args: ["--no-banner", ...commandArgs],
    displayCommand,
    envOverrides: {
      ...context.fixtureEnv,
    },
  });
}

function buildConfiguredStatusInvocation(context) {
  const home = createHome("pp-preview-status-");
  return buildLiveCommandInvocation(context, "js", {
    args: ["--no-banner", "--chain", "sepolia", "status", "--no-check"],
    displayCommand: "privacy-pools --no-banner --chain sepolia status --no-check",
    envOverrides: {
      ...context.fixtureEnv,
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
    },
    prepare: async () => {
      await runInitForConfiguredWallet(home, context.fixtureEnv);
    },
  });
}

function buildActivityInvocation(context, runtime, commandLabel, args) {
  return buildReadOnlyFixtureInvocation(
    context,
    runtime,
    args,
    commandLabel,
  );
}

function buildStatsInvocation(context, runtime, commandLabel, args) {
  return buildReadOnlyFixtureInvocation(
    context,
    runtime,
    args,
    commandLabel,
  );
}

function buildPoolsInvocation(context, runtime, commandLabel, args) {
  return buildReadOnlyFixtureInvocation(
    context,
    runtime,
    args,
    commandLabel,
  );
}

function buildForwardedPoolDetailInvocation(context) {
  return buildLiveCommandInvocation(context, "js", {
    args: ["--no-banner", "--chain", "sepolia", "pools", "ETH"],
    displayCommand: "privacy-pools --no-banner --chain sepolia pools ETH",
    envOverrides: {
      ...context.fixtureEnv,
    },
  });
}

export const PREVIEW_CASES = [
  createLivePreviewCase({
    id: "welcome-banner",
    label: "welcome banner",
    journey: "onboarding",
    surface: "welcome",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["banner", "brand", "launch"],
    commandLabel: "privacy-pools",
    buildInvocation: buildWelcomeBannerInvocation,
  }),
  createLivePreviewCase({
    id: "root-help",
    label: "root help",
    journey: "onboarding",
    surface: "help",
    owner: "native",
    runtime: "native",
    requiredSetup: ["native-binary"],
    covers: ["help", "navigation", "stderr"],
    commandLabel: "privacy-pools --help",
    buildInvocation: buildRootHelpInvocation,
  }),
  createLivePreviewCase({
    id: "guide",
    label: "guide",
    journey: "onboarding",
    surface: "guide",
    owner: "native",
    runtime: "native",
    requiredSetup: ["native-binary"],
    covers: ["guide", "onboarding", "stderr"],
    commandLabel: "privacy-pools guide",
    buildInvocation: buildGuideInvocation,
  }),
  createLivePreviewCase({
    id: "capabilities",
    label: "capabilities",
    journey: "onboarding",
    surface: "capabilities",
    owner: "native",
    runtime: "native",
    requiredSetup: ["native-binary"],
    covers: ["manifest", "discovery", "stderr"],
    commandLabel: "privacy-pools capabilities",
    buildInvocation: buildCapabilitiesInvocation,
  }),
  createLivePreviewCase({
    id: "describe-withdraw-quote",
    label: "describe withdraw quote",
    journey: "onboarding",
    surface: "describe",
    owner: "native",
    runtime: "native",
    requiredSetup: ["native-binary"],
    covers: ["metadata", "safety", "withdraw"],
    commandLabel: "privacy-pools describe withdraw quote",
    buildInvocation: buildDescribeWithdrawQuoteInvocation,
  }),
  createLivePreviewCase({
    id: "completion-bash",
    label: "completion | bash script",
    journey: "onboarding",
    surface: "completion-script",
    owner: "native",
    runtime: "native",
    requiredSetup: ["native-binary"],
    covers: ["completion", "script", "bash"],
    commandLabel: "privacy-pools completion bash",
    buildInvocation: (context) => buildCompletionScriptInvocation(context, "bash"),
  }),
  ...HELP_COMMAND_PATHS.map(createCommandHelpPreviewCase),
  createLivePreviewCase({
    id: "init-configured-wallet",
    label: "init configured wallet",
    journey: "onboarding",
    surface: "init",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet-inputs"],
    covers: ["setup", "wallet", "next-actions"],
    commandLabel:
      "privacy-pools --no-banner init --signer-only --private-key-file <key> --default-chain sepolia --yes",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-");
      const { mnemonic, privateKeyPath } = writeSecretFiles(home);
      return buildLiveCommandInvocation(context, "forwarded", {
        args: [
          "--no-banner",
          "init",
          "--signer-only",
          "--private-key-file",
          privateKeyPath,
          "--default-chain",
          "sepolia",
          "--yes",
        ],
        displayCommand:
          "privacy-pools --no-banner init --signer-only --private-key-file <key> --default-chain sepolia --yes",
        envOverrides: {
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
        },
        prepare: async () => {
          const configHome = join(home, ".privacy-pools");
          mkdirSync(join(configHome, "accounts"), { recursive: true });
          mkdirSync(join(configHome, "workflows"), { recursive: true });
          mkdirSync(join(configHome, "workflow-secrets"), { recursive: true });
          writeFileSync(
            join(configHome, "config.json"),
            `${JSON.stringify({ defaultChain: "sepolia", rpcOverrides: {} }, null, 2)}\n`,
            "utf8",
          );
          writeFileSync(join(configHome, ".mnemonic"), `${mnemonic}\n`, "utf8");
        },
      });
    },
  }),
  createScenarioPreviewCase({
    id: "init-generated",
    label: "init | generated wallet",
    journey: "onboarding",
    surface: "init",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["generated", "backup", "next-actions"],
    commandLabel:
      "privacy-pools --no-banner --yes init --default-chain sepolia --backup-file <path>",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-generated-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-generated",
        [
          "--no-banner",
          "--yes",
          "init",
          "--default-chain",
          "sepolia",
          "--backup-file",
          join(home, "privacy-pools-recovery.txt"),
        ],
        "privacy-pools --no-banner --yes init --default-chain sepolia --backup-file <path>",
        {
          envOverrides: {
            HOME: home,
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
  }),
  createLivePreviewCase({
    id: "init-imported",
    label: "init | imported wallet",
    journey: "onboarding",
    surface: "init",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet-inputs", "preview-scenario"],
    covers: ["imported", "recovery-phrase", "next-actions"],
    syntheticReason:
      "preview-only scenario fixture keeps the imported-wallet output deterministic without mutating local config",
    commandLabel:
      "privacy-pools --no-banner --yes init --default-chain sepolia --recovery-phrase-file <mnemonic>",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-imported-");
      const { mnemonicPath } = writeSecretFiles(home);
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-imported",
        [
          "--no-banner",
          "--yes",
          "init",
          "--default-chain",
          "sepolia",
          "--recovery-phrase-file",
          mnemonicPath,
        ],
        "privacy-pools --no-banner --yes init --default-chain sepolia --recovery-phrase-file <mnemonic>",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            HOME: home,
          },
        },
      );
    },
  }),
  createPromptScenarioCase({
    id: "init-overwrite-prompt",
    label: "init | overwrite prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "seeded-home"],
    covers: ["interactive", "overwrite-confirmation", "cancel"],
    commandLabel: "privacy-pools --no-banner init",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-overwrite-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-overwrite-prompt",
        ["--no-banner", "init"],
        "privacy-pools --no-banner init",
        {
          envOverrides: {
            HOME: home,
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, {});
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "What would you like to do?", send: "\u001b[B\r" },
      ],
    },
    stateId: "overwrite-confirm",
  }),
  createPromptScenarioCase({
    id: "init-setup-mode-prompt",
    label: "init | setup mode prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "setup-mode", "wallet"],
    args: ["--no-banner", "init"],
    commandLabel: "privacy-pools --no-banner init",
    stateId: "setup-mode",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-setup-mode-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-setup-mode-prompt",
        ["--no-banner", "init"],
        "privacy-pools --no-banner init",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            HOME: home,
          },
        },
      );
    },
  }),
  createPromptScenarioCase({
    id: "init-import-recovery-prompt",
    label: "init | load recovery prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "import", "recovery-phrase"],
    args: ["--no-banner", "init"],
    commandLabel: "privacy-pools --no-banner init",
    stateId: "import-recovery",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-import-prompt-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-import-recovery-prompt",
        ["--no-banner", "init"],
        "privacy-pools --no-banner init",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "How would you like to get started?", send: "\u001b[B\r" },
      ],
    },
  }),
  createPromptScenarioCase({
    id: "init-backup-method-prompt",
    label: "init | backup method prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "backup-method", "generated-wallet"],
    args: ["--no-banner", "init"],
    commandLabel: "privacy-pools --no-banner init",
    stateId: "backup-method",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-backup-method-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-backup-method-prompt",
        ["--no-banner", "init"],
        "privacy-pools --no-banner init",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "How would you like to get started?", send: "\r" },
      ],
    },
  }),
  createPromptScenarioCase({
    id: "init-backup-path-prompt",
    label: "init | backup path prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "backup-path", "generated-wallet"],
    args: ["--no-banner", "init"],
    commandLabel: "privacy-pools --no-banner init",
    stateId: "backup-path",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-backup-path-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-backup-path-prompt",
        ["--no-banner", "init"],
        "privacy-pools --no-banner init",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "How would you like to get started?", send: "\r" },
        { waitFor: "How would you like to back up your recovery phrase?", send: "\r" },
      ],
    },
  }),
  createPromptScenarioCase({
    id: "init-backup-confirm-prompt",
    label: "init | backup confirm prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "backup-confirm", "generated-wallet"],
    args: ["--no-banner", "init"],
    commandLabel: "privacy-pools --no-banner init",
    stateId: "backup-confirm",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-backup-confirm-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-backup-confirm-prompt",
        ["--no-banner", "init"],
        "privacy-pools --no-banner init",
        {
          envOverrides: {
            HOME: home,
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "How would you like to get started?", send: "\r" },
        { waitFor: "How would you like to back up your recovery phrase?", send: "\r" },
        { waitFor: "Save location:", send: "\r" },
      ],
    },
  }),
  createPromptScenarioCase({
    id: "init-recovery-verification-prompt",
    label: "init | recovery verification prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "verification", "generated-wallet"],
    args: ["--no-banner", "init"],
    commandLabel: "privacy-pools --no-banner init",
    stateId: "recovery-verification",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-recovery-verification-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-recovery-verification-prompt",
        ["--no-banner", "init"],
        "privacy-pools --no-banner init",
        {
          envOverrides: {
            HOME: home,
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "How would you like to get started?", send: "\r" },
        { waitFor: "How would you like to back up your recovery phrase?", send: "\u001b[B\r" },
        { waitFor: "I have securely backed up my recovery phrase.", send: "y\r" },
      ],
    },
  }),
  createPromptScenarioCase({
    id: "init-signer-key-prompt",
    label: "init | signer key prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet-inputs", "preview-scenario"],
    covers: ["interactive", "signer-key", "wallet"],
    commandLabel:
      "privacy-pools --no-banner init --recovery-phrase-file <mnemonic> --default-chain sepolia",
    stateId: "signer-key",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-signer-key-");
      const { mnemonicPath } = writeSecretFiles(home);
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-signer-key-prompt",
        [
          "--no-banner",
          "init",
          "--recovery-phrase-file",
          mnemonicPath,
          "--default-chain",
          "sepolia",
        ],
        "privacy-pools --no-banner init --recovery-phrase-file <mnemonic> --default-chain sepolia",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
  }),
  createPromptScenarioCase({
    id: "init-default-chain-prompt",
    label: "init | default chain prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet-inputs", "preview-scenario"],
    covers: ["interactive", "default-chain", "wallet"],
    commandLabel:
      "privacy-pools --no-banner init --recovery-phrase-file <mnemonic>",
    stateId: "default-chain",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-default-chain-");
      const { mnemonicPath } = writeSecretFiles(home);
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "init-default-chain-prompt",
        [
          "--no-banner",
          "init",
          "--recovery-phrase-file",
          mnemonicPath,
        ],
        "privacy-pools --no-banner init --recovery-phrase-file <mnemonic>",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "Signer key (private key, 0x..., or Enter to skip):", send: "\r" },
      ],
    },
  }),
  createProgressPreviewCase({
    id: "init-progress-restore-discovery",
    label: "init | restore discovery progress",
    journey: "onboarding",
    surface: "init-progress",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet-inputs"],
    covers: ["restore", "discovery", "progress"],
    commandPath: "init",
    progressStep: "init.restore-discovery",
    stateId: "restore-discovery",
    args: [
      "--no-banner",
      "--yes",
      "init",
      "--default-chain",
      "sepolia",
      "--recovery-phrase-file",
      "<mnemonic>",
    ],
    commandLabel:
      "privacy-pools --no-banner --yes init --default-chain sepolia --recovery-phrase-file <mnemonic>",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-restore-discovery-");
      const { mnemonicPath } = writeSecretFiles(home);
      return buildLiveCommandInvocation(context, "forwarded", {
        args: [
          "--no-banner",
          "--yes",
          "init",
          "--default-chain",
          "sepolia",
          "--recovery-phrase-file",
          mnemonicPath,
        ],
        displayCommand:
          "privacy-pools --no-banner --yes init --default-chain sepolia --recovery-phrase-file <mnemonic>",
        envOverrides: {
          HOME: home,
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP: "init.restore-discovery",
        },
      });
    },
  }),
  createLivePreviewCase({
    id: "js-activity-global",
    label: "activity | js",
    journey: "discovery",
    surface: "activity",
    owner: "js",
    runtime: "js",
    requiredSetup: ["fixture-server"],
    covers: ["global-feed", "table", "filters"],
    commandLabel: "privacy-pools --no-banner activity",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildActivityInvocation(
        context,
        "js",
        "privacy-pools --no-banner activity",
        ["--no-banner", "activity"],
      ),
  }),
  createLivePreviewCase({
    id: "native-activity-global",
    label: "activity | native",
    journey: "discovery",
    surface: "activity",
    owner: "native",
    runtime: "native",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["global-feed", "table", "filters"],
    commandLabel: "privacy-pools --no-banner activity",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildActivityInvocation(
        context,
        "native",
        "privacy-pools --no-banner activity",
        ["--no-banner", "activity"],
      ),
  }),
  createLivePreviewCase({
    id: "js-activity-pool",
    label: "activity | pool | js",
    journey: "discovery",
    surface: "activity",
    owner: "js",
    runtime: "js",
    requiredSetup: ["fixture-server"],
    covers: ["pool-feed", "pagination", "table"],
    commandLabel: "privacy-pools --no-banner --chain sepolia activity --asset ETH",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildActivityInvocation(
        context,
        "js",
        "privacy-pools --no-banner --chain sepolia activity --asset ETH",
        ["--chain", "sepolia", "activity", "--asset", "ETH"],
      ),
  }),
  createLivePreviewCase({
    id: "native-activity-pool",
    label: "activity | pool | native",
    journey: "discovery",
    surface: "activity",
    owner: "native",
    runtime: "native",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["pool-feed", "pagination", "table"],
    commandLabel: "privacy-pools --no-banner --chain sepolia activity --asset ETH",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildActivityInvocation(
        context,
        "native",
        "privacy-pools --no-banner --chain sepolia activity --asset ETH",
        ["--chain", "sepolia", "activity", "--asset", "ETH"],
      ),
  }),
  createScenarioPreviewCase({
    id: "activity-empty",
    label: "activity | empty",
    journey: "discovery",
    surface: "activity",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["empty-state", "global-feed"],
    args: ["--no-banner", "--chain", "sepolia", "activity"],
    commandLabel: "privacy-pools --no-banner --chain sepolia activity",
  }),
  createProgressPreviewCase({
    id: "activity-progress-fetch",
    label: "activity | loading",
    journey: "discovery",
    surface: "activity",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["loading", "spinner", "read-only"],
    args: ["--no-banner", "activity"],
    commandLabel: "privacy-pools --no-banner activity",
    progressStep: "activity.fetch",
    commandPath: "activity",
    stateId: "fetch-progress",
    runtimeTarget: "js",
  }),
  createLivePreviewCase({
    id: "js-stats-global",
    label: "stats | js",
    journey: "discovery",
    surface: "stats",
    owner: "js",
    runtime: "js",
    requiredSetup: ["fixture-server"],
    covers: ["global-summary", "layout", "table"],
    commandLabel: "privacy-pools --no-banner stats",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildStatsInvocation(
        context,
        "js",
        "privacy-pools --no-banner stats",
        ["--no-banner", "stats"],
      ),
  }),
  createLivePreviewCase({
    id: "native-stats-global",
    label: "stats | native",
    journey: "discovery",
    surface: "stats",
    owner: "native",
    runtime: "native",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["global-summary", "layout", "table"],
    commandLabel: "privacy-pools --no-banner stats",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildStatsInvocation(
        context,
        "native",
        "privacy-pools --no-banner stats",
        ["--no-banner", "stats"],
      ),
  }),
  createLivePreviewCase({
    id: "js-stats-pool",
    label: "stats pool | js",
    journey: "discovery",
    surface: "stats",
    owner: "js",
    runtime: "js",
    requiredSetup: ["fixture-server"],
    covers: ["pool-summary", "table", "next-actions"],
    commandLabel: "privacy-pools --no-banner stats pool --asset ETH --chain sepolia",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildStatsInvocation(
        context,
        "js",
        "privacy-pools --no-banner stats pool --asset ETH --chain sepolia",
        ["stats", "pool", "--asset", "ETH", "--chain", "sepolia"],
      ),
  }),
  createLivePreviewCase({
    id: "native-stats-pool",
    label: "stats pool | native",
    journey: "discovery",
    surface: "stats",
    owner: "native",
    runtime: "native",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["pool-summary", "table", "next-actions"],
    commandLabel: "privacy-pools --no-banner stats pool --asset ETH --chain sepolia",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildStatsInvocation(
        context,
        "native",
        "privacy-pools --no-banner stats pool --asset ETH --chain sepolia",
        ["stats", "pool", "--asset", "ETH", "--chain", "sepolia"],
      ),
  }),
  createProgressPreviewCase({
    id: "stats-progress-global-fetch",
    label: "stats | global loading",
    journey: "discovery",
    surface: "stats",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["loading", "spinner", "global-summary"],
    args: ["--no-banner", "stats"],
    commandLabel: "privacy-pools --no-banner stats",
    progressStep: "stats.global.fetch",
    commandPath: "stats",
    stateId: "global-fetch-progress",
    runtimeTarget: "js",
  }),
  createProgressPreviewCase({
    id: "stats-progress-pool-fetch",
    label: "stats pool | loading",
    journey: "discovery",
    surface: "stats",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["loading", "spinner", "pool-summary"],
    needsFixtureServer: true,
    args: ["stats", "pool", "--asset", "ETH", "--chain", "sepolia"],
    commandLabel: "privacy-pools --no-banner stats pool --asset ETH --chain sepolia",
    progressStep: "stats.pool.fetch",
    commandPath: "stats pool",
    stateId: "pool-fetch-progress",
    runtimeTarget: "js",
    envOverrides: (context) => ({
      ...context.fixtureEnv,
    }),
  }),
  createLivePreviewCase({
    id: "js-pools-list",
    label: "pools list | js",
    journey: "discovery",
    surface: "pools",
    owner: "js",
    runtime: "js",
    requiredSetup: ["fixture-server"],
    covers: ["list", "table", "search"],
    commandLabel: "privacy-pools --no-banner pools",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildPoolsInvocation(
        context,
        "js",
        "privacy-pools --no-banner pools",
        ["--no-banner", "pools"],
      ),
  }),
  createScenarioPreviewCase({
    id: "pools-empty",
    label: "pools | empty",
    journey: "discovery",
    surface: "pools",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["empty-state", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "pools"],
    commandLabel: "privacy-pools --no-banner --chain sepolia pools",
  }),
  createScenarioPreviewCase({
    id: "pools-no-match",
    label: "pools | no match",
    journey: "discovery",
    surface: "pools",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["search", "no-match", "empty-state"],
    args: ["--no-banner", "--chain", "sepolia", "pools", "--search", "ZZZ"],
    commandLabel: "privacy-pools --no-banner --chain sepolia pools --search ZZZ",
  }),
  createLivePreviewCase({
    id: "native-pools-list",
    label: "pools list | native",
    journey: "discovery",
    surface: "pools",
    owner: "native",
    runtime: "native",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["list", "table", "search"],
    commandLabel: "privacy-pools --no-banner pools",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildPoolsInvocation(
        context,
        "native",
        "privacy-pools --no-banner pools",
        ["--no-banner", "pools"],
      ),
  }),
  createProgressPreviewCase({
    id: "pools-progress-list-fetch",
    label: "pools | list loading",
    journey: "discovery",
    surface: "pools",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["loading", "spinner", "list"],
    args: ["--no-banner", "pools"],
    commandLabel: "privacy-pools --no-banner pools",
    progressStep: "pools.list.fetch",
    commandPath: "pools",
    stateId: "list-fetch-progress",
    runtimeTarget: "js",
  }),
  createLivePreviewCase({
    id: "native-pools-no-match",
    label: "pools | no match | native",
    journey: "discovery",
    surface: "pools",
    owner: "native",
    runtime: "native",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["search", "no-match", "empty-state"],
    commandLabel: "privacy-pools --no-banner --chain sepolia pools --search ZZZ",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildPoolsInvocation(
        context,
        "native",
        "privacy-pools --no-banner --chain sepolia pools --search ZZZ",
        ["--chain", "sepolia", "pools", "--search", "ZZZ"],
      ),
  }),
  createLivePreviewCase({
    id: "native-pool-detail",
    label: "pool detail | native",
    journey: "discovery",
    surface: "pools",
    owner: "native",
    runtime: "native",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["detail", "wallet-warning", "activity"],
    commandLabel: "privacy-pools --no-banner --chain sepolia pools ETH",
    needsFixtureServer: true,
    buildInvocation: (context) =>
      buildLiveCommandInvocation(context, "native", {
        args: ["--no-banner", "--chain", "sepolia", "pools", "ETH"],
        displayCommand: "privacy-pools --no-banner --chain sepolia pools ETH",
        envOverrides: {
          ...context.fixtureEnv,
        },
      }),
  }),
  createProgressPreviewCase({
    id: "pools-progress-detail-fetch",
    label: "pools | detail loading",
    journey: "discovery",
    surface: "pools",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["loading", "spinner", "detail"],
    args: ["--no-banner", "--chain", "sepolia", "pools", "ETH"],
    commandLabel: "privacy-pools --no-banner --chain sepolia pools ETH",
    progressStep: "pools.detail.fetch",
    commandPath: "pools",
    stateId: "detail-fetch-progress",
    runtimeTarget: "js",
  }),
  createLivePreviewCase({
    id: "forwarded-pool-detail",
    label: "pool detail",
    journey: "discovery",
    surface: "pools",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["fixture-server", "native-binary"],
    covers: ["detail", "funds", "activity"],
    commandLabel: "privacy-pools --no-banner --chain sepolia pools ETH",
    needsFixtureServer: true,
    buildInvocation: (context) => buildForwardedPoolDetailInvocation(context),
  }),
  createLivePreviewCase({
    id: "forwarded-status-configured",
    label: "status | configured wallet | js",
    journey: "accounts",
    surface: "status",
    owner: "js",
    runtime: "js",
    requiredSetup: ["fixture-server", "configured-wallet"],
    covers: ["configured", "next-actions", "readiness"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status --no-check",
    needsFixtureServer: true,
    runtimeTarget: "js",
    buildInvocation: (context) => buildConfiguredStatusInvocation(context),
  }),
  createScenarioPreviewCase({
    id: "status-setup-required",
    label: "status | setup required",
    journey: "accounts",
    surface: "status",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["setup-required", "blocking-issues", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status",
    runtimeTarget: "js",
  }),
  createScenarioPreviewCase({
    id: "status-ready",
    label: "status | ready",
    journey: "accounts",
    surface: "status",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["ready", "health", "next-actions"],
    truthRequirement: "live-required",
    args: ["--no-banner", "--chain", "sepolia", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status",
    runtimeTarget: "js",
  }),
  createScenarioPreviewCase({
    id: "status-degraded",
    label: "status | degraded",
    journey: "accounts",
    surface: "status",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["read-only", "degraded", "warnings"],
    truthRequirement: "live-required",
    args: ["--no-banner", "--chain", "sepolia", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status",
    runtimeTarget: "js",
  }),
  createProgressPreviewCase({
    id: "status-progress-health-check",
    label: "status | health check progress",
    journey: "accounts",
    surface: "status",
    owner: "js",
    runtime: "js",
    requiredSetup: ["none"],
    covers: ["health", "loading", "spinner"],
    args: ["--no-banner", "--chain", "sepolia", "status", "--check"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status --check",
    progressStep: "status.health-check",
    commandPath: "status",
    stateId: "health-check-progress",
    runtimeTarget: "js",
  }),
  createScenarioPreviewCase({
    id: "accounts-empty",
    label: "accounts | empty",
    journey: "accounts",
    surface: "accounts",
    requiredSetup: ["native-binary"],
    covers: ["empty-state", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "accounts"],
    commandLabel: "privacy-pools --no-banner --chain sepolia accounts",
  }),
  createScenarioPreviewCase({
    id: "accounts-pending-empty",
    label: "accounts | pending empty",
    journey: "accounts",
    surface: "accounts",
    requiredSetup: ["native-binary"],
    covers: ["pending-only", "empty-state", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "accounts", "--pending-only"],
    commandLabel: "privacy-pools --no-banner --chain sepolia accounts --pending-only",
  }),
  createScenarioPreviewCase({
    id: "accounts-populated",
    label: "accounts | populated",
    journey: "accounts",
    surface: "accounts",
    requiredSetup: ["native-binary"],
    covers: ["summary", "details", "balances"],
    args: ["--no-banner", "--chain", "sepolia", "accounts", "--details"],
    commandLabel: "privacy-pools --no-banner --chain sepolia accounts --details",
  }),
  createScenarioPreviewCase({
    id: "accounts-details",
    label: "accounts | details",
    journey: "accounts",
    surface: "accounts",
    requiredSetup: ["native-binary"],
    covers: ["details", "balances", "statuses"],
    args: ["--no-banner", "--chain", "sepolia", "accounts", "--details"],
    commandLabel: "privacy-pools --no-banner --chain sepolia accounts --details",
  }),
  createScenarioPreviewCase({
    id: "accounts-summary",
    label: "accounts | summary",
    journey: "accounts",
    surface: "accounts",
    requiredSetup: ["native-binary"],
    covers: ["summary", "counts", "balances"],
    args: ["--no-banner", "--chain", "sepolia", "accounts", "--summary"],
    commandLabel: "privacy-pools --no-banner --chain sepolia accounts --summary",
  }),
  createScenarioPreviewCase({
    id: "accounts-verbose",
    label: "accounts | verbose",
    journey: "accounts",
    surface: "accounts",
    requiredSetup: ["native-binary"],
    covers: ["verbose", "details", "metadata"],
    args: ["--no-banner", "--verbose", "--chain", "sepolia", "accounts", "--details"],
    commandLabel: "privacy-pools --no-banner --verbose --chain sepolia accounts --details",
  }),
  createScenarioPreviewCase({
    id: "history-empty",
    label: "history | empty",
    journey: "accounts",
    surface: "history",
    requiredSetup: ["native-binary"],
    covers: ["empty-state", "history"],
    args: ["--no-banner", "--chain", "sepolia", "history"],
    commandLabel: "privacy-pools --no-banner --chain sepolia history",
  }),
  createScenarioPreviewCase({
    id: "history-populated",
    label: "history | populated",
    journey: "accounts",
    surface: "history",
    requiredSetup: ["native-binary"],
    covers: ["timeline", "table", "summary"],
    args: ["--no-banner", "--chain", "sepolia", "history"],
    commandLabel: "privacy-pools --no-banner --chain sepolia history",
  }),
  createScenarioPreviewCase({
    id: "sync-empty",
    label: "sync | empty",
    journey: "accounts",
    surface: "sync",
    requiredSetup: ["native-binary"],
    covers: ["empty-state", "sync"],
    args: ["--no-banner", "--chain", "sepolia", "sync"],
    commandLabel: "privacy-pools --no-banner --chain sepolia sync",
  }),
  createScenarioPreviewCase({
    id: "sync-success",
    label: "sync | success",
    journey: "accounts",
    surface: "sync",
    requiredSetup: ["native-binary"],
    covers: ["success", "sync", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "sync"],
    commandLabel: "privacy-pools --no-banner --chain sepolia sync",
  }),
  createScenarioPreviewCase({
    id: "migrate-status-no-legacy",
    label: "migrate status | no legacy",
    journey: "accounts",
    surface: "migrate",
    requiredSetup: ["native-binary"],
    covers: ["no-legacy", "read-only", "summary"],
    args: ["--no-banner", "--chain", "sepolia", "migrate", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia migrate status",
  }),
  createScenarioPreviewCase({
    id: "migrate-status-migration-required",
    label: "migrate status | migration required",
    journey: "accounts",
    surface: "migrate",
    requiredSetup: ["native-binary"],
    covers: ["migration-required", "per-chain", "website-action"],
    args: ["--no-banner", "--chain", "sepolia", "migrate", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia migrate status",
  }),
  createScenarioPreviewCase({
    id: "migrate-status-website-recovery",
    label: "migrate status | website recovery",
    journey: "accounts",
    surface: "migrate",
    requiredSetup: ["native-binary"],
    covers: ["website-recovery", "declined", "read-only"],
    args: ["--no-banner", "--chain", "sepolia", "migrate", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia migrate status",
  }),
  createScenarioPreviewCase({
    id: "migrate-status-review-incomplete",
    label: "migrate status | review incomplete",
    journey: "accounts",
    surface: "migrate",
    requiredSetup: ["native-binary"],
    covers: ["review-incomplete", "warnings", "coverage"],
    args: ["--no-banner", "--chain", "sepolia", "migrate", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia migrate status",
  }),
  createScenarioPreviewCase({
    id: "migrate-status-fully-migrated",
    label: "migrate status | fully migrated",
    journey: "accounts",
    surface: "migrate",
    requiredSetup: ["native-binary"],
    covers: ["fully-migrated", "summary", "per-chain"],
    args: ["--no-banner", "--chain", "sepolia", "migrate", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia migrate status",
  }),
  createScenarioPreviewCase({
    id: "deposit-dry-run",
    label: "deposit | dry run",
    journey: "deposit",
    surface: "deposit",
    requiredSetup: ["native-binary"],
    covers: ["dry-run", "next-actions", "validation"],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.1", "ETH", "--dry-run"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.1 ETH --dry-run",
  }),
  createScenarioPreviewCase({
    id: "deposit-success",
    label: "deposit | success",
    journey: "deposit",
    surface: "deposit",
    requiredSetup: ["native-binary"],
    covers: ["success", "transaction"],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.1", "ETH"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.1 ETH",
  }),
  createScenarioPreviewCase({
    id: "deposit-unsigned-envelope",
    label: "deposit | unsigned envelope",
    journey: "deposit",
    surface: "deposit",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "envelope", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.1", "ETH", "--unsigned"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.1 ETH --unsigned",
  }),
  createScenarioPreviewCase({
    id: "deposit-unsigned-tx",
    label: "deposit | unsigned tx",
    journey: "deposit",
    surface: "deposit",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "tx-array", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.1", "ETH", "--unsigned", "tx"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.1 ETH --unsigned tx",
  }),
  createScenarioPreviewCase({
    id: "deposit-validation",
    label: "deposit | validation",
    journey: "deposit",
    surface: "deposit",
    requiredSetup: ["native-binary"],
    covers: ["validation-error", "privacy-guard"],
    expectedExitCodes: [2],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.123456789", "ETH"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.123456789 ETH",
  }),
  createPromptScenarioCase({
    id: "deposit-asset-select-prompt",
    label: "deposit | asset select prompt",
    journey: "deposit",
    surface: "deposit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "asset-select", "pool-choice"],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.1"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.1",
    stateId: "asset-select",
  }),
  createPromptScenarioCase({
    id: "deposit-unique-amount-prompt",
    label: "deposit | unique amount prompt",
    journey: "deposit",
    surface: "deposit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "unique-amount", "confirm"],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.123456789", "ETH"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.123456789 ETH",
    stateId: "unique-amount-confirm",
  }),
  createPromptScenarioCase({
    id: "deposit-confirm-prompt",
    label: "deposit | confirm prompt",
    journey: "deposit",
    surface: "deposit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "confirm", "fee-review"],
    args: ["--no-banner", "--chain", "sepolia", "deposit", "0.1", "ETH"],
    commandLabel: "privacy-pools --no-banner --chain sepolia deposit 0.1 ETH",
    stateId: "confirm",
  }),
  createProgressPreviewCase({
    id: "deposit-progress-approve-token",
    label: "deposit | progress | approve token",
    journey: "deposit",
    surface: "deposit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "approve-token", "erc20"],
    args: ["--yes", "--no-banner", "--chain", "arbitrum", "deposit", "50", "USDC"],
    commandLabel: "privacy-pools --yes --no-banner --chain arbitrum deposit 50 USDC",
    progressStep: "deposit.approve-token",
    stateId: "approve-token",
  }),
  createProgressPreviewCase({
    id: "deposit-progress-submit",
    label: "deposit | progress | submit",
    journey: "deposit",
    surface: "deposit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "submit", "transaction"],
    args: ["--yes", "--no-banner", "--chain", "sepolia", "deposit", "0.1", "ETH"],
    commandLabel: "privacy-pools --yes --no-banner --chain sepolia deposit 0.1 ETH",
    progressStep: "deposit.submit",
    stateId: "submit",
  }),
  createScenarioPreviewCase({
    id: "withdraw-quote",
    label: "withdraw | quote",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["quote", "template", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "quote", "150", "USDC", "--to", TEST_RECIPIENT],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw quote 150 USDC --to 0x000000000000000000000000000000000000dEaD",
  }),
  createScenarioPreviewCase({
    id: "withdraw-quote-template",
    label: "withdraw | quote | template",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["quote", "template", "runnable-false"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "quote", "150", "USDC"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw quote 150 USDC",
  }),
  createScenarioPreviewCase({
    id: "withdraw-dry-run-relayed",
    label: "withdraw | dry run | relayed",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["dry-run", "relayed", "proof"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT, "--dry-run"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD --dry-run",
  }),
  createScenarioPreviewCase({
    id: "withdraw-success-relayed",
    label: "withdraw | success | relayed",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["success", "relayed", "transaction"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
  }),
  createScenarioPreviewCase({
    id: "withdraw-dry-run-direct",
    label: "withdraw | dry run | direct",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["dry-run", "direct", "proof"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "0.3", "ETH", "--to", TEST_RECIPIENT, "--direct", "--dry-run"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 0.3 ETH --to 0x000000000000000000000000000000000000dEaD --direct --dry-run",
  }),
  createScenarioPreviewCase({
    id: "withdraw-success-direct",
    label: "withdraw | success | direct",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["success", "direct", "transaction"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "0.3", "ETH", "--to", TEST_RECIPIENT, "--direct"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 0.3 ETH --to 0x000000000000000000000000000000000000dEaD --direct",
  }),
  createScenarioPreviewCase({
    id: "withdraw-unsigned-envelope",
    label: "withdraw | unsigned envelope",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "envelope", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT, "--unsigned"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD --unsigned",
  }),
  createScenarioPreviewCase({
    id: "withdraw-unsigned-tx",
    label: "withdraw | unsigned tx",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "tx-array", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT, "--unsigned", "tx"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD --unsigned tx",
  }),
  createScenarioPreviewCase({
    id: "withdraw-validation",
    label: "withdraw | validation",
    journey: "withdraw",
    surface: "withdraw",
    requiredSetup: ["native-binary"],
    covers: ["validation-error", "direct", "unsigned"],
    expectedExitCodes: [2],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "0.3", "ETH", "--direct", "--unsigned"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 0.3 ETH --direct --unsigned",
  }),
  createLivePreviewCase({
    id: "withdraw-confirm",
    label: "withdraw | confirm prompt",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    modes: ["tty"],
    requiredSetup: ["native-binary", "configured-wallet", "fixture-server", "preview-scenario"],
    covers: ["interactive", "review", "confirm"],
    syntheticReason:
      "preview-only scenario fixture keeps the withdrawal confirmation screen deterministic without generating a proof or contacting a relayer",
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-withdraw-confirm-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "withdraw-confirm",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "withdraw",
          "50",
          "USDC",
          "--to",
          TEST_RECIPIENT,
        ],
        "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
    ttyScript: {
      steps: [],
      finalPauseMs: 250,
    },
    requiresTtyScript: true,
  }),
  createPromptScenarioCase({
    id: "withdraw-pa-select-prompt",
    label: "withdraw | pool account select prompt",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet", "fixture-server", "preview-scenario"],
    covers: ["interactive", "pool-account-select", "review"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
    stateId: "pool-account-select",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-withdraw-pa-select-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "withdraw-pa-select-prompt",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "withdraw",
          "50",
          "USDC",
          "--to",
          TEST_RECIPIENT,
        ],
        "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
  }),
  createPromptScenarioCase({
    id: "withdraw-recipient-prompt",
    label: "withdraw | recipient prompt",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet", "fixture-server", "preview-scenario"],
    covers: ["interactive", "recipient", "review"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --pool-account PA-4",
    stateId: "recipient-input",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-withdraw-recipient-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "withdraw-recipient-prompt",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "withdraw",
          "50",
          "USDC",
          "--pool-account",
          "PA-4",
        ],
        "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --pool-account PA-4",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
  }),
  createPromptScenarioCase({
    id: "withdraw-direct-confirm-prompt",
    label: "withdraw | direct confirm prompt",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet", "fixture-server", "preview-scenario"],
    covers: ["interactive", "direct", "confirm"],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 0.3 ETH --direct",
    stateId: "direct-confirm",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-withdraw-direct-confirm-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "withdraw-direct-confirm-prompt",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "withdraw",
          "0.3",
          "ETH",
          "--direct",
        ],
        "privacy-pools --no-banner --chain sepolia withdraw 0.3 ETH --direct",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
  }),
  createProgressPreviewCase({
    id: "withdraw-progress-sync-account-state",
    label: "withdraw | progress | sync account state",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "sync-account-state", "withdraw"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
    progressStep: "withdraw.sync-account-state",
    stateId: "sync-account-state",
  }),
  createProgressPreviewCase({
    id: "withdraw-progress-request-quote",
    label: "withdraw | progress | request quote",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "request-quote", "relayed"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
    progressStep: "withdraw.request-quote",
    stateId: "request-quote",
  }),
  createProgressPreviewCase({
    id: "withdraw-progress-generate-proof",
    label: "withdraw | progress | generate proof",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "generate-proof", "withdraw"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
    progressStep: "withdraw.generate-proof",
    stateId: "generate-proof",
  }),
  createProgressPreviewCase({
    id: "withdraw-progress-submit-direct",
    label: "withdraw | progress | submit direct",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "submit", "direct"],
    args: [
      "--no-banner",
      "--chain",
      "sepolia",
      "withdraw",
      "0.3",
      "ETH",
      "--direct",
      "--to",
      "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    ],
    commandLabel:
      "privacy-pools --no-banner --chain sepolia withdraw 0.3 ETH --direct --to 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    progressStep: "withdraw.submit-direct",
    stateId: "submit-direct",
  }),
  createProgressPreviewCase({
    id: "withdraw-progress-submit-relayed",
    label: "withdraw | progress | submit relayed",
    journey: "withdraw",
    surface: "withdraw",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "submit", "relayed"],
    args: ["--no-banner", "--chain", "sepolia", "withdraw", "50", "USDC", "--to", TEST_RECIPIENT],
    commandLabel: "privacy-pools --no-banner --chain sepolia withdraw 50 USDC --to 0x000000000000000000000000000000000000dEaD",
    progressStep: "withdraw.submit-relayed",
    stateId: "submit-relayed",
  }),
  createScenarioPreviewCase({
    id: "ragequit-dry-run",
    label: "ragequit | dry run",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["dry-run", "recovery", "proof"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3", "--dry-run"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3 --dry-run",
  }),
  createScenarioPreviewCase({
    id: "ragequit-success",
    label: "ragequit | success",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["success", "recovery", "transaction"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3",
  }),
  createScenarioPreviewCase({
    id: "ragequit-unsigned-envelope",
    label: "ragequit | unsigned envelope",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "envelope", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3", "--unsigned"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3 --unsigned",
  }),
  createScenarioPreviewCase({
    id: "ragequit-unsigned-tx",
    label: "ragequit | unsigned tx",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "tx-array", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3", "--unsigned", "tx"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3 --unsigned tx",
  }),
  createScenarioPreviewCase({
    id: "ragequit-validation",
    label: "ragequit | validation",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["validation-error", "selection"],
    expectedExitCodes: [2],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3", "--commitment", "123"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3 --commitment 123",
  }),
  createLivePreviewCase({
    id: "ragequit-select",
    label: "ragequit | select prompt",
    journey: "recovery",
    surface: "ragequit",
    owner: "forwarded",
    runtime: "forwarded",
    modes: ["tty"],
    requiredSetup: [
      "native-binary",
      "configured-wallet",
      "fixture-server",
      "preview-scenario",
    ],
    covers: ["interactive", "selection", "recovery"],
    syntheticReason:
      "preview-only scenario fixture keeps the Pool Account recovery picker deterministic without loading live wallet state",
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-ragequit-select-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "ragequit-select",
        ["--no-banner", "--chain", "sepolia", "ragequit", "ETH"],
        "privacy-pools --no-banner --chain sepolia ragequit ETH",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
    ttyScript: {
      steps: [],
      finalPauseMs: 250,
    },
    requiresTtyScript: true,
  }),
  createLivePreviewCase({
    id: "ragequit-confirm",
    label: "ragequit | confirm prompt",
    journey: "recovery",
    surface: "ragequit",
    owner: "forwarded",
    runtime: "forwarded",
    modes: ["tty"],
    requiredSetup: [
      "native-binary",
      "configured-wallet",
      "fixture-server",
      "preview-scenario",
    ],
    covers: ["interactive", "review", "confirm"],
    syntheticReason:
      "preview-only scenario fixture keeps the public recovery confirmation screen deterministic without generating a proof",
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-ragequit-confirm-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "ragequit-confirm",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "ragequit",
          "ETH",
          "--pool-account",
          "PA-3",
        ],
        "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
    ttyScript: {
      steps: [],
      finalPauseMs: 250,
    },
    requiresTtyScript: true,
  }),
  createProgressPreviewCase({
    id: "ragequit-progress-load-account",
    label: "ragequit | progress | load account",
    journey: "recovery",
    surface: "ragequit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "load-account", "recovery"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3",
    progressStep: "ragequit.load-account",
    stateId: "load-account",
  }),
  createProgressPreviewCase({
    id: "ragequit-progress-generate-proof",
    label: "ragequit | progress | generate proof",
    journey: "recovery",
    surface: "ragequit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "generate-proof", "recovery"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3",
    progressStep: "ragequit.generate-proof",
    stateId: "generate-proof",
  }),
  createProgressPreviewCase({
    id: "ragequit-progress-submit",
    label: "ragequit | progress | submit",
    journey: "recovery",
    surface: "ragequit",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "submit", "recovery"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-3"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --pool-account PA-3",
    progressStep: "ragequit.submit",
    stateId: "submit",
  }),
  createScenarioPreviewCase({
    id: "upgrade-check",
    label: "upgrade | check",
    journey: "maintenance",
    surface: "upgrade",
    requiredSetup: ["native-binary"],
    covers: ["check", "next-actions"],
    args: ["--no-banner", "upgrade", "--check"],
    commandLabel: "privacy-pools --no-banner upgrade --check",
  }),
  createScenarioPreviewCase({
    id: "upgrade-manual-only",
    label: "upgrade | manual only",
    journey: "maintenance",
    surface: "upgrade",
    requiredSetup: ["native-binary"],
    covers: ["manual-only", "update-available", "check"],
    args: ["--no-banner", "upgrade", "--check"],
    commandLabel: "privacy-pools --no-banner upgrade --check",
  }),
  createScenarioPreviewCase({
    id: "upgrade-no-update",
    label: "upgrade | up to date",
    journey: "maintenance",
    surface: "upgrade",
    requiredSetup: ["native-binary"],
    covers: ["up-to-date", "summary"],
    args: ["--no-banner", "upgrade", "--check"],
    commandLabel: "privacy-pools --no-banner upgrade --check",
  }),
  createScenarioPreviewCase({
    id: "upgrade-auto-available",
    label: "upgrade | auto available",
    journey: "maintenance",
    surface: "upgrade",
    requiredSetup: ["native-binary"],
    covers: ["auto-run", "update-available", "check"],
    args: ["--no-banner", "upgrade", "--check"],
    commandLabel: "privacy-pools --no-banner upgrade --check",
  }),
  createScenarioPreviewCase({
    id: "upgrade-ready",
    label: "upgrade | ready",
    journey: "maintenance",
    surface: "upgrade",
    requiredSetup: ["native-binary"],
    covers: ["ready", "auto-run", "manual-command"],
    args: ["--no-banner", "upgrade", "--check"],
    commandLabel: "privacy-pools --no-banner upgrade --check",
  }),
  createScenarioPreviewCase({
    id: "upgrade-performed",
    label: "upgrade | performed",
    journey: "maintenance",
    surface: "upgrade",
    requiredSetup: ["native-binary"],
    covers: ["performed", "success", "summary"],
    args: ["--no-banner", "upgrade", "--yes"],
    commandLabel: "privacy-pools --no-banner upgrade --yes",
  }),
  createPromptScenarioCase({
    id: "upgrade-confirm-prompt",
    label: "upgrade | confirm prompt",
    journey: "maintenance",
    surface: "upgrade",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "preview-scenario"],
    covers: ["interactive", "install-confirm", "upgrade"],
    args: ["--no-banner", "upgrade"],
    commandLabel: "privacy-pools --no-banner upgrade",
    stateId: "install-confirm",
    envOverrides: {
      PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
    },
  }),
  createProgressPreviewCase({
    id: "upgrade-progress-check",
    label: "upgrade | progress | check",
    journey: "maintenance",
    surface: "upgrade",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "check", "upgrade"],
    args: ["--no-banner", "upgrade", "--check"],
    commandLabel: "privacy-pools --no-banner upgrade --check",
    progressStep: "upgrade.check",
    stateId: "check",
  }),
  createProgressPreviewCase({
    id: "upgrade-progress-install",
    label: "upgrade | progress | install",
    journey: "maintenance",
    surface: "upgrade",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary"],
    covers: ["progress", "install", "upgrade"],
    args: ["--no-banner", "upgrade", "--yes"],
    commandLabel: "privacy-pools --no-banner upgrade --yes",
    progressStep: "upgrade.install",
    stateId: "install",
  }),
  createScenarioPreviewCase({
    id: "flow-start-validation",
    label: "flow start | validation",
    journey: "flow",
    surface: "flow-start",
    requiredSetup: ["native-binary"],
    covers: ["validation-error", "recipient"],
    expectedExitCodes: [2],
    args: ["--no-banner", "flow", "start", "0.1", "ETH"],
    commandLabel: "privacy-pools --no-banner flow start 0.1 ETH",
  }),
  createLivePreviewCase({
    id: "flow-start-interactive-prompt",
    label: "flow start | interactive prompt",
    journey: "flow",
    surface: "flow-start",
    owner: "forwarded",
    runtime: "forwarded",
    modes: ["tty"],
    requiredSetup: ["native-binary", "configured-wallet", "preview-scenario"],
    covers: ["interactive", "recipient-prompt", "configured-wallet"],
    syntheticReason:
      "preview-only scenario fixture keeps the prompted flow-start screen deterministic without submitting a public deposit",
    commandLabel: "privacy-pools --no-banner flow start 0.1 ETH",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-flow-start-interactive-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "flow-start-configured",
        ["--no-banner", "flow", "start", "0.1", "ETH"],
        "privacy-pools --no-banner flow start 0.1 ETH",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, {});
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "Recipient address:", send: `${TEST_RECIPIENT}\r` },
      ],
      finalPauseMs: 250,
    },
    requiresTtyScript: true,
  }),
  createPromptScenarioCase({
    id: "flow-start-confirm-prompt",
    label: "flow start | confirm prompt",
    journey: "flow",
    surface: "flow-start",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet", "preview-scenario"],
    covers: ["interactive", "confirm", "configured-wallet"],
    commandLabel: "privacy-pools --no-banner flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD",
    stateId: "confirm",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-flow-start-confirm-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "flow-start-confirm-prompt",
        ["--no-banner", "flow", "start", "0.1", "ETH", "--to", TEST_RECIPIENT],
        "privacy-pools --no-banner flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, {});
          },
        },
      );
    },
  }),
  createScenarioPreviewCase({
    id: "flow-start-configured",
    label: "flow start | configured wallet",
    journey: "flow",
    surface: "flow-start",
    requiredSetup: ["native-binary"],
    covers: ["start", "configured-wallet", "next-actions"],
    args: ["--no-banner", "flow", "start", "0.1", "ETH", "--to", TEST_RECIPIENT],
    commandLabel: "privacy-pools --no-banner flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD",
  }),
  createScenarioPreviewCase({
    id: "flow-start-new-wallet",
    label: "flow start | new wallet",
    journey: "flow",
    surface: "flow-start",
    requiredSetup: ["native-binary"],
    covers: ["start", "new-wallet", "funding"],
    args: ["--no-banner", "flow", "start", "0.1", "ETH", "--to", TEST_RECIPIENT, "--new-wallet", "--export-new-wallet", "/tmp/preview-flow-wallet.txt"],
    commandLabel: "privacy-pools --no-banner flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --new-wallet --export-new-wallet /tmp/preview-flow-wallet.txt",
  }),
  createLivePreviewCase({
    id: "flow-start-new-wallet-backup-choice",
    label: "flow start | new wallet | backup choice",
    journey: "flow",
    surface: "flow-start",
    owner: "forwarded",
    runtime: "forwarded",
    modes: ["tty"],
    requiredSetup: [
      "native-binary",
      "configured-wallet",
      "fixture-server",
      "preview-scenario",
    ],
    covers: ["interactive", "new-wallet", "backup-choice"],
    syntheticReason:
      "preview-only scenario fixture keeps the workflow-wallet backup choice screen deterministic without creating or funding a live wallet",
    commandLabel: "privacy-pools --no-banner --chain sepolia flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --new-wallet",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-flow-start-backup-choice-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "flow-start-new-wallet-backup-choice",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "flow",
          "start",
          "0.1",
          "ETH",
          "--to",
          TEST_RECIPIENT,
          "--new-wallet",
        ],
        "privacy-pools --no-banner --chain sepolia flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --new-wallet",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "Confirm flow start?", send: "y\r" },
      ],
      finalPauseMs: 250,
    },
    requiresTtyScript: true,
  }),
  createPromptScenarioCase({
    id: "flow-start-new-wallet-backup-path-prompt",
    label: "flow start | new wallet | backup path prompt",
    journey: "flow",
    surface: "flow-start",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: [
      "native-binary",
      "configured-wallet",
      "fixture-server",
      "preview-scenario",
    ],
    covers: ["interactive", "new-wallet", "backup-path"],
    commandLabel: "privacy-pools --no-banner --chain sepolia flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --new-wallet",
    stateId: "workflow-wallet-backup-path",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-flow-start-backup-path-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "flow-start-new-wallet-backup-path-prompt",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "flow",
          "start",
          "0.1",
          "ETH",
          "--to",
          TEST_RECIPIENT,
          "--new-wallet",
        ],
        "privacy-pools --no-banner --chain sepolia flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --new-wallet",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "Confirm flow start?", send: "y\r" },
      ],
      finalPauseMs: 250,
    },
  }),
  createLivePreviewCase({
    id: "flow-start-new-wallet-backup-confirm",
    label: "flow start | new wallet | backup confirm",
    journey: "flow",
    surface: "flow-start",
    owner: "forwarded",
    runtime: "forwarded",
    modes: ["tty"],
    requiredSetup: [
      "native-binary",
      "configured-wallet",
      "fixture-server",
      "preview-scenario",
    ],
    covers: ["interactive", "new-wallet", "backup-confirm"],
    syntheticReason:
      "preview-only scenario fixture keeps the workflow-wallet backup confirmation screen deterministic without creating or funding a live wallet",
    commandLabel: "privacy-pools --no-banner --chain sepolia flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --new-wallet",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-flow-start-backup-confirm-");
      return buildPreviewScenarioInvocation(
        context,
        "forwarded",
        "flow-start-new-wallet-backup-confirm",
        [
          "--no-banner",
          "--chain",
          "sepolia",
          "flow",
          "start",
          "0.1",
          "ETH",
          "--to",
          TEST_RECIPIENT,
          "--new-wallet",
        ],
        "privacy-pools --no-banner --chain sepolia flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --new-wallet",
        {
          envOverrides: {
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
            ...context.fixtureEnv,
          },
          prepare: async () => {
            await runInitForConfiguredWallet(home, context.fixtureEnv);
          },
        },
      );
    },
    ttyScript: {
      steps: [
        { waitFor: "Confirm flow start?", send: "y\r" },
      ],
      finalPauseMs: 250,
    },
    requiresTtyScript: true,
  }),
  createScenarioPreviewCase({
    id: "flow-start-watch",
    label: "flow start | watch enabled",
    journey: "flow",
    surface: "flow-start",
    requiredSetup: ["native-binary"],
    covers: ["start", "watch", "next-actions"],
    args: ["--no-banner", "flow", "start", "0.1", "ETH", "--to", TEST_RECIPIENT, "--watch"],
    commandLabel: "privacy-pools --no-banner flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD --watch",
  }),
  createProgressPreviewCase({
    id: "flow-start-progress-submit-deposit",
    label: "flow start | progress | submit deposit",
    journey: "flow",
    surface: "flow-start",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["native-binary", "configured-wallet"],
    needsFixtureServer: true,
    covers: ["progress", "submit-deposit", "configured-wallet"],
    commandLabel: "privacy-pools --yes --no-banner flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD",
    progressStep: "flow.start.submit-deposit",
    stateId: "submit-deposit",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-flow-start-progress-submit-");
      return buildLiveCommandInvocation(context, "forwarded", {
        args: ["--yes", "--no-banner", "flow", "start", "0.1", "ETH", "--to", TEST_RECIPIENT],
        displayCommand:
          "privacy-pools --yes --no-banner flow start 0.1 ETH --to 0x000000000000000000000000000000000000dEaD",
        envOverrides: {
          ...context.fixtureEnv,
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP: "flow.start.submit-deposit",
        },
        prepare: async () => {
          await runInitForConfiguredWallet(home, context.fixtureEnv);
        },
      });
    },
  }),
  createScenarioPreviewCase({
    id: "flow-watch-awaiting-funding",
    label: "flow watch | awaiting funding",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "awaiting-funding", "wallet"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-awaiting-asp",
    label: "flow watch | awaiting asp",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "awaiting-asp", "review"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-waiting-privacy-delay",
    label: "flow watch | privacy delay",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "privacy-delay", "waiting"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-ready",
    label: "flow watch | ready",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "ready", "withdraw"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-withdrawing",
    label: "flow watch | withdrawing",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "withdrawing", "progress"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-completed",
    label: "flow watch | completed",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "completed", "success"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-public-recovery",
    label: "flow watch | public recovery",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "public-recovery", "recovery"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-declined",
    label: "flow watch | declined",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "declined", "recovery"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-poi-required",
    label: "flow watch | poi required",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "poi-required", "recovery"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-relayer-minimum",
    label: "flow watch | relayer minimum blocked",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "relayer-minimum", "recovery"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-watch-stopped-external",
    label: "flow watch | stopped external",
    journey: "flow",
    surface: "flow-watch",
    requiredSetup: ["native-binary"],
    covers: ["watch", "stopped-external", "manual-followup"],
    args: ["--no-banner", "flow", "watch", "latest"],
    commandLabel: "privacy-pools --no-banner flow watch latest",
  }),
  createScenarioPreviewCase({
    id: "flow-ragequit-success",
    label: "flow ragequit | success",
    journey: "flow",
    surface: "flow-ragequit",
    requiredSetup: ["native-binary"],
    covers: ["ragequit", "success", "recovery"],
    args: ["--no-banner", "flow", "ragequit", "latest"],
    commandLabel: "privacy-pools --no-banner flow ragequit latest",
  }),
  createScenarioPreviewCase({
    id: "flow-ragequit-error",
    label: "flow ragequit | error",
    journey: "flow",
    surface: "flow-ragequit",
    requiredSetup: ["native-binary"],
    covers: ["ragequit", "error", "terminal"],
    expectedExitCodes: [2],
    args: ["--no-banner", "flow", "ragequit", "latest"],
    commandLabel: "privacy-pools --no-banner flow ragequit latest",
  }),
  ...FLOW_STATUS_PREVIEW_PHASES.map(createFlowStatusCase),
];

function writeSecretFiles(home) {
  const secretsDir = join(home, ".preview-secrets");
  mkdirSync(secretsDir, { recursive: true });

  const mnemonicPath = join(secretsDir, "mnemonic.txt");
  const privateKeyPath = join(secretsDir, "private-key.txt");
  writeFileSync(mnemonicPath, `${TEST_MNEMONIC}\n`, "utf8");
  writeFileSync(privateKeyPath, `${TEST_PRIVATE_KEY}\n`, "utf8");

  return { mnemonicPath, privateKeyPath };
}

function buildChildEnv(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      key === "NO_COLOR" ||
      key.startsWith("PRIVACY_POOLS_") ||
      key.startsWith("PP_")
    ) {
      continue;
    }
    env[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  env.FORCE_COLOR = "1";
  env.NODE_NO_WARNINGS = "1";
  env.PP_NO_UPDATE_CHECK = "1";
  env.TERM = env.TERM ?? "xterm-256color";
  env.LANG = env.LANG ?? "en_US.UTF-8";
  env.LC_ALL = env.LC_ALL ?? env.LANG;
  return env;
}

function createHome(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE_BIN = process.execPath;
const DEFAULT_NATIVE_BINARY = join(
  ROOT_DIR,
  "native",
  "shell",
  "target",
  "debug",
  process.platform === "win32"
    ? "privacy-pools-cli-native-shell.exe"
    : "privacy-pools-cli-native-shell",
);

function wait(ms) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}

function normalizeWriter(writer, fallback) {
  return typeof writer === "function" ? writer : fallback;
}

function writeLine(writer, value = "") {
  writer(`${value}\n`);
}

function writeBlock(writer, label, value) {
  writeLine(writer, label);
  if (!value || value.length === 0) {
    writeLine(writer, "(empty)");
    return;
  }

  writer(value.endsWith("\n") ? value : `${value}\n`);
}

function formatCommand(args) {
  return ["privacy-pools", ...args].join(" ");
}

function runNodeScriptSync(scriptPath, args, options = {}) {
  const result = spawnSync(NODE_BIN, ["--import", "tsx", scriptPath, ...args], {
    cwd: ROOT_DIR,
    env: buildChildEnv(options.env),
    encoding: "utf8",
    input: options.input,
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    errorMessage: result.error?.message,
  };
}

function runCliSync(args, options = {}) {
  return runNodeScriptSync("src/index.ts", args, options);
}

async function launchFixtureServer() {
  const script = join(ROOT_DIR, "test", "helpers", "fixture-server.ts");
  const proc = spawn(NODE_BIN, ["--import", "tsx", script], {
    cwd: ROOT_DIR,
    env: buildChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      rejectPromise(new Error("Fixture server did not start within 20s"));
      try {
        proc.kill("SIGTERM");
      } catch {
        // Best effort.
      }
    }, 20_000);

    const fail = (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
      try {
        proc.kill("SIGTERM");
      } catch {
        // Best effort.
      }
    };

    proc.stdout?.on("data", async (chunk) => {
      output += chunk.toString();
      const match = output.match(/FIXTURE_PORT=(\d+)/);
      if (!match) return;

      clearTimeout(timeout);
      const port = Number(match[1]);
      const url = `http://127.0.0.1:${port}`;
      try {
        await waitForFixtureReady(url);
        resolvePromise({
          url,
          port,
          proc,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", fail);
    proc.on("exit", (code) => {
      if (code === 0 || output.includes("FIXTURE_PORT=")) {
        return;
      }
      fail(
        new Error(
          `Fixture server exited early with code ${code ?? "null"}\n${stderr}`,
        ),
      );
    });
  });
}

async function waitForFixtureReady(url) {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_chainId",
    params: [],
  };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The fixture can take a brief moment to become reachable after it prints the port.
    }
    await wait(50);
  }

  throw new Error(`Fixture server did not become reachable at ${url}`);
}

async function killFixtureServer(fixture) {
  if (!fixture) return;
  try {
    fixture.proc.kill("SIGTERM");
  } catch {
    // Best effort.
  }
}

async function runInitForConfiguredWallet(home, fixtureEnv) {
  const configHome = join(home, ".privacy-pools");
  mkdirSync(join(configHome, "accounts"), { recursive: true });
  mkdirSync(join(configHome, "workflows"), { recursive: true });
  mkdirSync(join(configHome, "workflow-secrets"), { recursive: true });
  writeFileSync(
    join(configHome, "config.json"),
    `${JSON.stringify({ defaultChain: "sepolia", rpcOverrides: {} }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(configHome, ".mnemonic"), `${TEST_MNEMONIC}\n`, "utf8");
  writeFileSync(join(configHome, ".signer"), `${TEST_PRIVATE_KEY}\n`, "utf8");
}

function writeFlowSnapshot(home, snapshot) {
  const workflowsDir = join(home, ".privacy-pools", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(
    join(workflowsDir, `${snapshot.workflowId}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

function createFlowSnapshot({
  workflowId,
  phase,
  walletMode = "configured",
  walletAddress = null,
  privacyDelayProfile = "balanced",
  privacyDelayConfigured = true,
  privacyDelayUntil = null,
  poolAccountId = "PA-1",
  poolAccountNumber = 1,
  depositTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  depositBlockNumber = "12345",
  depositExplorerUrl = "https://example.test/tx/0xaaaaaaaa",
  committedValue = "99500000000000000",
  withdrawTxHash = null,
  withdrawBlockNumber = null,
  withdrawExplorerUrl = null,
  ragequitTxHash = null,
  ragequitBlockNumber = null,
  ragequitExplorerUrl = null,
  aspStatus = "pending",
  lastError = null,
}) {
  return {
    schemaVersion: "2",
    workflowId,
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:00:00.000Z",
    phase,
    walletMode,
    walletAddress,
    assetDecimals: 18,
    requiredNativeFunding: walletMode === "new_wallet" ? "3500000000000000" : null,
    requiredTokenFunding: walletMode === "new_wallet" ? "100000000000000000" : null,
    backupConfirmed: walletMode === "new_wallet",
    privacyDelayProfile,
    privacyDelayConfigured,
    privacyDelayUntil,
    chain: "sepolia",
    asset: "ETH",
    depositAmount: "100000000000000000",
    recipient: TEST_RECIPIENT,
    poolAccountId,
    poolAccountNumber,
    depositTxHash,
    depositBlockNumber,
    depositExplorerUrl,
    depositLabel: "12345",
    committedValue,
    aspStatus,
    withdrawTxHash,
    withdrawBlockNumber,
    withdrawExplorerUrl,
    ragequitTxHash,
    ragequitBlockNumber,
    ragequitExplorerUrl,
    pendingSubmission: null,
    lastError,
  };
}

function createFlowSnapshotForPhase(phase) {
  switch (phase) {
    case "awaiting_funding":
      return createFlowSnapshot({
        workflowId: "wf-awaiting-funding",
        phase,
        walletMode: "new_wallet",
        walletAddress: "0x000000000000000000000000000000000000f10f",
        poolAccountId: null,
        poolAccountNumber: null,
        depositTxHash: null,
        depositBlockNumber: null,
        depositExplorerUrl: null,
        committedValue: null,
      });
    case "depositing_publicly":
      return createFlowSnapshot({
        workflowId: "wf-depositing",
        phase,
        walletMode: "configured",
        poolAccountId: null,
        poolAccountNumber: null,
        depositBlockNumber: null,
        committedValue: null,
      });
    case "awaiting_asp":
      return createFlowSnapshot({
        workflowId: "wf-awaiting-asp",
        phase,
        aspStatus: "pending",
      });
    case "approved_waiting_privacy_delay":
      return createFlowSnapshot({
        workflowId: "wf-waiting-delay",
        phase,
        aspStatus: "approved",
        privacyDelayUntil: "2026-04-07T18:30:00.000Z",
      });
    case "approved_ready_to_withdraw":
      return createFlowSnapshot({
        workflowId: "wf-ready-withdraw",
        phase,
        aspStatus: "approved",
      });
    case "withdrawing":
      return createFlowSnapshot({
        workflowId: "wf-withdrawing",
        phase,
        aspStatus: "approved",
        withdrawTxHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });
    case "completed":
      return createFlowSnapshot({
        workflowId: "wf-completed",
        phase,
        aspStatus: "approved",
        withdrawTxHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        withdrawBlockNumber: "12399",
        withdrawExplorerUrl: "https://example.test/tx/0xbbbbbbbb",
      });
    case "completed_public_recovery":
      return createFlowSnapshot({
        workflowId: "wf-public-recovery",
        phase,
        aspStatus: "declined",
        ragequitTxHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        ragequitBlockNumber: "12425",
        ragequitExplorerUrl: "https://example.test/tx/0xcccccccc",
      });
    case "paused_declined":
      return createFlowSnapshot({
        workflowId: "wf-declined",
        phase,
        aspStatus: "declined",
        lastError: {
          step: "asp_review",
          errorCode: "FLOW_DECLINED",
          errorMessage: "The ASP declined this workflow during review.",
          retryable: false,
          at: "2026-03-27T12:05:00.000Z",
        },
      });
    case "paused_poi_required":
      return createFlowSnapshot({
        workflowId: "wf-poi-required",
        phase,
        aspStatus: "poi_required",
        lastError: {
          step: "asp_review",
          errorCode: "FLOW_POI_REQUIRED",
          errorMessage: "Proof of Association is required before a private withdrawal.",
          retryable: false,
          at: "2026-03-27T12:05:00.000Z",
        },
      });
    case "stopped_external":
      return createFlowSnapshot({
        workflowId: "wf-stopped-external",
        phase,
        aspStatus: "approved",
        lastError: {
          step: "reconcile",
          errorCode: "FLOW_STOPPED_EXTERNAL",
          errorMessage: "The saved Pool Account changed outside this workflow.",
          retryable: false,
          at: "2026-03-27T12:05:00.000Z",
        },
      });
    default:
      throw new Error(`Unsupported flow preview phase: ${phase}`);
  }
}

function buildFixtureEnv(fixture) {
  if (!fixture) return {};
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_MAINNET: fixture.url,
    PRIVACY_POOLS_RPC_URL_ARBITRUM: fixture.url,
    PRIVACY_POOLS_RPC_URL_OPTIMISM: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
  };
}

function launcherEnvForRuntime(runtime, nativeBinary, nativeBinaryAvailable) {
  if (runtime === "js") {
    return {
      env: { PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1" },
      skipReason: null,
    };
  }

  if (!nativeBinaryAvailable) {
    return {
      env: {},
      skipReason: `Native shell binary not found at ${nativeBinary}. Run npm run native:build first.`,
    };
  }

  return {
    env: { PRIVACY_POOLS_CLI_BINARY: nativeBinary },
    skipReason: null,
  };
}

function createPlanEntry(previewCase, execution) {
  return {
    ...previewCase,
    execution,
  };
}

function createPreviewInvocationFromCase(plan, context) {
  if (plan.execution.kind === "renderer-fixture") {
    return {
      command: NODE_BIN,
      args: [
        "--import",
        "tsx",
        "scripts/preview-cli-render-fixture.mjs",
        plan.execution.fixtureCaseId,
      ],
      displayCommand: plan.execution.commandLabel,
      env: buildChildEnv(),
    };
  }

  const invocation = plan.execution.buildInvocation?.(context);
  if (!invocation) {
    throw new Error(`Preview case is missing a live invocation builder: ${plan.id}`);
  }
  return invocation;
}

function formatModeList(modes) {
  return Array.isArray(modes) && modes.length > 0 ? modes.join(", ") : "-";
}

function formatCoverList(covers) {
  return Array.isArray(covers) && covers.length > 0 ? covers.join(", ") : "-";
}

function formatSetupList(requiredSetup) {
  return requiredSetup.join(", ");
}

function formatSyntheticReason(syntheticReason) {
  return syntheticReason ?? "-";
}

function formatPreviewSectionTitle(plan) {
  return `${plan.journey} | ${plan.label} [${plan.owner} / ${plan.source}]`;
}

function printCaseHeader(writer, plan) {
  writeLine(writer, "");
  writeLine(writer, `=== ${formatPreviewSectionTitle(plan)} ===`);
  writeLine(writer, `Case ID: ${plan.id}`);
  writeLine(writer, `Surface: ${plan.surface}`);
  writeLine(writer, `Runtime: ${plan.runtime}`);
  writeLine(writer, `Execution: ${plan.executionKind}`);
  writeLine(writer, `Modes: ${formatModeList(plan.modes)}`);
  writeLine(writer, `Covers: ${formatCoverList(plan.covers)}`);
  writeLine(writer, `Setup: ${formatSetupList(plan.requiredSetup)}`);
  if (plan.syntheticReason) {
    writeLine(writer, `Synthetic: ${plan.syntheticReason}`);
  }
}

export function findPreviewCase(caseId) {
  return PREVIEW_CASES.find((previewCase) => previewCase.id === caseId) ?? null;
}

export function listPreviewCaseIds() {
  return PREVIEW_CASES.map((previewCase) => previewCase.id);
}
