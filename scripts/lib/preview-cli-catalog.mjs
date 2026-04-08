import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";

export const PREVIEW_OWNERS = ["js", "native", "forwarded"];
export const PREVIEW_RUNTIMES = ["js", "native", "forwarded"];
export const PREVIEW_SOURCES = ["live-command", "renderer-fixture"];
export const PREVIEW_EXECUTION_KINDS = ["live-command", "renderer-fixture"];
export const PREVIEW_MODES = ["captured", "tty"];

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

const HELP_COMMAND_PATHS = [
  "init",
  "upgrade",
  "flow",
  "flow start",
  "flow watch",
  "flow status",
  "flow ragequit",
  "pools",
  "activity",
  "stats",
  "stats global",
  "stats pool",
  "status",
  "capabilities",
  "describe",
  "guide",
  "deposit",
  "withdraw",
  "withdraw quote",
  "ragequit",
  "accounts",
  "migrate",
  "migrate status",
  "history",
  "sync",
  "completion",
];

function clonePreviewModes() {
  return [...PREVIEW_MODES];
}

function createPreviewCase(config) {
  return {
    expectedExitCodes: [0],
    modes: clonePreviewModes(),
    ...config,
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
}) {
  return createPreviewCase({
    ...(modes ? { modes } : {}),
    ...(expectedExitCodes ? { expectedExitCodes } : {}),
    id,
    label,
    journey,
    surface,
    owner,
    runtime,
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
}) {
  return createPreviewCase({
    ...(modes ? { modes } : {}),
    ...(expectedExitCodes ? { expectedExitCodes } : {}),
    id,
    label,
    journey,
    surface,
    owner,
    runtime,
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
  ttyScript,
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
    requiredSetup: [...requiredSetup, "preview-scenario"],
    covers,
    syntheticReason:
      syntheticReason ??
      "preview-only scenario fixture keeps this command deterministic without moving funds or mutating local installs",
    commandLabel,
    buildInvocation: (context) =>
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
  return buildLiveCommandInvocation(context, "forwarded", {
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
  return buildLiveCommandInvocation(context, "forwarded", {
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
      "privacy-pools --no-banner init --recovery-phrase-file <mnemonic> --private-key-file <key> --default-chain sepolia --yes",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-");
      const { mnemonicPath, privateKeyPath } = writeSecretFiles(home);
      return buildLiveCommandInvocation(context, "forwarded", {
        args: [
          "--no-banner",
          "init",
          "--recovery-phrase-file",
          mnemonicPath,
          "--private-key-file",
          privateKeyPath,
          "--default-chain",
          "sepolia",
          "--yes",
        ],
        displayCommand:
          "privacy-pools --no-banner init --recovery-phrase-file <mnemonic> --private-key-file <key> --default-chain sepolia --yes",
        envOverrides: {
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
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
    covers: ["generated", "warning", "next-actions"],
    args: ["--no-banner", "--yes", "init", "--default-chain", "sepolia"],
    commandLabel: "privacy-pools --no-banner --yes init --default-chain sepolia",
    envOverrides: () => {
      const home = createHome("pp-preview-init-generated-");
      return {
        PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      };
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
          },
        },
      );
    },
  }),
  createLivePreviewCase({
    id: "init-overwrite-prompt",
    label: "init | overwrite prompt",
    journey: "onboarding",
    surface: "init-prompt",
    owner: "forwarded",
    runtime: "forwarded",
    modes: ["tty"],
    requiredSetup: ["native-binary", "seeded-home"],
    covers: ["interactive", "overwrite-confirmation", "cancel"],
    commandLabel: "privacy-pools --no-banner init",
    buildInvocation: (context) => {
      const home = createHome("pp-preview-init-overwrite-");
      return buildLiveCommandInvocation(context, "forwarded", {
        args: ["--no-banner", "init"],
        displayCommand: "privacy-pools --no-banner init",
        envOverrides: {
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
        },
        prepare: async () => {
          await runInitForConfiguredWallet(home, {});
        },
      });
    },
    ttyScript: {
      steps: [
        { waitFor: "Continue?", send: "n\r" },
      ],
      finalPauseMs: 250,
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
    requiredSetup: [],
    covers: ["empty-state", "global-feed"],
    args: ["--no-banner", "--chain", "sepolia", "activity"],
    commandLabel: "privacy-pools --no-banner --chain sepolia activity",
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
    requiredSetup: [],
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
    requiredSetup: [],
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
    label: "status | configured wallet",
    journey: "accounts",
    surface: "status",
    owner: "forwarded",
    runtime: "forwarded",
    requiredSetup: ["fixture-server", "native-binary", "configured-wallet"],
    covers: ["configured", "next-actions", "readiness"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status --no-check",
    needsFixtureServer: true,
    buildInvocation: (context) => buildConfiguredStatusInvocation(context),
  }),
  createScenarioPreviewCase({
    id: "status-setup-required",
    label: "status | setup required",
    journey: "accounts",
    surface: "status",
    requiredSetup: ["native-binary"],
    covers: ["setup-required", "blocking-issues", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status",
  }),
  createScenarioPreviewCase({
    id: "status-ready",
    label: "status | ready",
    journey: "accounts",
    surface: "status",
    requiredSetup: ["native-binary"],
    covers: ["ready", "health", "next-actions"],
    args: ["--no-banner", "--chain", "sepolia", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status",
  }),
  createScenarioPreviewCase({
    id: "status-degraded",
    label: "status | degraded",
    journey: "accounts",
    surface: "status",
    requiredSetup: ["native-binary"],
    covers: ["read-only", "degraded", "warnings"],
    args: ["--no-banner", "--chain", "sepolia", "status"],
    commandLabel: "privacy-pools --no-banner --chain sepolia status",
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
  createScenarioPreviewCase({
    id: "ragequit-dry-run",
    label: "ragequit | dry run",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["dry-run", "recovery", "proof"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--from-pa", "PA-3", "--dry-run"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --from-pa PA-3 --dry-run",
  }),
  createScenarioPreviewCase({
    id: "ragequit-success",
    label: "ragequit | success",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["success", "recovery", "transaction"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--from-pa", "PA-3"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --from-pa PA-3",
  }),
  createScenarioPreviewCase({
    id: "ragequit-unsigned-envelope",
    label: "ragequit | unsigned envelope",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "envelope", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--from-pa", "PA-3", "--unsigned"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --from-pa PA-3 --unsigned",
  }),
  createScenarioPreviewCase({
    id: "ragequit-unsigned-tx",
    label: "ragequit | unsigned tx",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["unsigned", "tx-array", "stdout"],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--from-pa", "PA-3", "--unsigned", "tx"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --from-pa PA-3 --unsigned tx",
  }),
  createScenarioPreviewCase({
    id: "ragequit-validation",
    label: "ragequit | validation",
    journey: "recovery",
    surface: "ragequit",
    requiredSetup: ["native-binary"],
    covers: ["validation-error", "selection"],
    expectedExitCodes: [2],
    args: ["--no-banner", "--chain", "sepolia", "ragequit", "ETH", "--from-pa", "PA-3", "--commitment", "123"],
    commandLabel: "privacy-pools --no-banner --chain sepolia ragequit ETH --from-pa PA-3 --commitment 123",
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
  createScenarioPreviewCase({
    id: "flow-start-validation",
    label: "flow start | validation",
    journey: "flow",
    surface: "flow-start",
    requiredSetup: ["native-binary"],
    covers: ["validation-error", "recipient"],
    expectedExitCodes: [1],
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
  const { mnemonicPath, privateKeyPath } = writeSecretFiles(home);
  const result = runCliSync(
    [
      "--agent",
      "init",
      "--recovery-phrase-file",
      mnemonicPath,
      "--private-key-file",
      privateKeyPath,
      "--default-chain",
      "sepolia",
      "--yes",
    ],
    {
      env: {
        PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        ...fixtureEnv,
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Configured wallet setup failed (${result.status ?? "null"}): ${result.stderr || result.stdout || result.errorMessage || "unknown error"}`,
    );
  }
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
