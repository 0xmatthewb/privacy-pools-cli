import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLOW_STATUS_PREVIEW_PHASES,
  PREVIEW_CASES,
  findPreviewCase,
} from "./preview-cli-catalog.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE_BIN = process.execPath;
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
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

function writeSecretFiles(home) {
  const secretsDir = join(home, ".preview-secrets");
  mkdirSync(secretsDir, { recursive: true });

  const mnemonicPath = join(secretsDir, "mnemonic.txt");
  const privateKeyPath = join(secretsDir, "private-key.txt");
  writeFileSync(mnemonicPath, `${TEST_MNEMONIC}\n`, "utf8");
  writeFileSync(privateKeyPath, `${TEST_PRIVATE_KEY}\n`, "utf8");

  return { mnemonicPath, privateKeyPath };
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

function formatSetupList(requiredSetup) {
  return requiredSetup.join(", ");
}

function formatPreviewSectionTitle(plan) {
  return `${plan.journey} | ${plan.label} [${plan.owner} / ${plan.source}]`;
}

function printCaseHeader(writer, plan) {
  writeLine(writer, "");
  writeLine(writer, `=== ${formatPreviewSectionTitle(plan)} ===`);
  writeLine(writer, `Case ID: ${plan.id}`);
  writeLine(writer, `Setup: ${formatSetupList(plan.requiredSetup)}`);
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

export function resolvePreviewExecution(caseId) {
  const previewCase = findPreviewCase(caseId);
  if (!previewCase) {
    throw new Error(`Unknown preview case: ${caseId}`);
  }

  switch (caseId) {
    case "welcome-banner":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "js",
        commandLabel: "privacy-pools",
        needsFixtureServer: false,
      });
    case "root-help":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "native",
        commandLabel: "privacy-pools --help",
        needsFixtureServer: false,
      });
    case "guide":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "native",
        commandLabel: "privacy-pools guide",
        needsFixtureServer: false,
      });
    case "capabilities":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "native",
        commandLabel: "privacy-pools capabilities",
        needsFixtureServer: false,
      });
    case "describe-withdraw-quote":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "native",
        commandLabel: "privacy-pools describe withdraw quote",
        needsFixtureServer: false,
      });
    case "init-configured-wallet":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "forwarded",
        commandLabel:
          "privacy-pools --no-banner init --recovery-phrase-file <mnemonic> --private-key-file <key> --default-chain sepolia --yes",
        needsFixtureServer: false,
      });
    case "js-activity-global":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "js",
        commandLabel: "privacy-pools --no-banner activity",
        needsFixtureServer: true,
      });
    case "native-activity-global":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "native",
        commandLabel: "privacy-pools --no-banner activity",
        needsFixtureServer: true,
      });
    case "js-stats-global":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "js",
        commandLabel: "privacy-pools --no-banner stats",
        needsFixtureServer: true,
      });
    case "native-stats-global":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "native",
        commandLabel: "privacy-pools --no-banner stats",
        needsFixtureServer: true,
      });
    case "js-pools-list":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "js",
        commandLabel: "privacy-pools --no-banner pools",
        needsFixtureServer: true,
      });
    case "native-pools-list":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "native",
        commandLabel: "privacy-pools --no-banner pools",
        needsFixtureServer: true,
      });
    case "forwarded-pool-detail":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "forwarded",
        commandLabel: "privacy-pools --no-banner --chain sepolia pools ETH",
        needsFixtureServer: true,
      });
    case "forwarded-status-configured":
      return createPlanEntry(previewCase, {
        kind: "live-command",
        runtime: "forwarded",
        commandLabel: "privacy-pools --no-banner --chain sepolia status --no-check",
        needsFixtureServer: true,
      });
    case "accounts-empty":
    case "accounts-pending-empty":
    case "accounts-populated":
    case "deposit-dry-run":
    case "deposit-success":
    case "withdraw-quote":
    case "withdraw-dry-run-relayed":
    case "withdraw-success-relayed":
    case "withdraw-dry-run-direct":
    case "withdraw-success-direct":
    case "ragequit-dry-run":
    case "ragequit-success":
    case "upgrade-check":
      return createPlanEntry(previewCase, {
        kind: "renderer-fixture",
        fixtureCaseId: caseId,
        commandLabel: `preview fixture: ${caseId}`,
        needsFixtureServer: false,
      });
    default: {
      if (caseId.startsWith("flow-status-")) {
        return createPlanEntry(previewCase, {
          kind: "live-command",
          runtime: "forwarded",
          commandLabel: "privacy-pools --no-banner flow status latest",
          needsFixtureServer: false,
          flowPhase: caseId.slice("flow-status-".length),
        });
      }

      throw new Error(`Preview case is missing an execution plan: ${caseId}`);
    }
  }
}

export function planPreviewSuite(caseIds = null) {
  const ids = caseIds && caseIds.length > 0
    ? caseIds
    : PREVIEW_CASES.map((previewCase) => previewCase.id);
  return ids.map((caseId) => resolvePreviewExecution(caseId));
}

export function parsePreviewArgs(argv = process.argv.slice(2)) {
  const caseIds = [];
  let listOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --case");
      }
      caseIds.push(value);
      index += 1;
      continue;
    }
    if (arg === "--list") {
      listOnly = true;
      continue;
    }
    throw new Error(`Unknown preview argument: ${arg}`);
  }

  return {
    caseIds: caseIds.length > 0 ? caseIds : null,
    listOnly,
  };
}

export function formatPreviewCaseList(caseIds = null) {
  const plans = planPreviewSuite(caseIds);
  return plans
    .map(
      (plan) =>
        `${plan.id} | ${plan.journey} | ${plan.owner} | ${plan.source} | ${formatSetupList(plan.requiredSetup)}`,
    )
    .join("\n");
}

function createRunContext(options = {}) {
  const writeOut = normalizeWriter(options.writeOut, (value) => process.stdout.write(value));
  const writeErr = normalizeWriter(options.writeErr, (value) => process.stderr.write(value));
  const nativeBinary = options.nativeBinary?.trim() || process.env.PRIVACY_POOLS_CLI_BINARY?.trim() || DEFAULT_NATIVE_BINARY;
  const nativeBinaryAvailable = existsSync(nativeBinary);

  return {
    writeOut,
    writeErr,
    nativeBinary,
    nativeBinaryAvailable,
    failures: [],
    fixture: null,
    fixtureEnv: {},
  };
}

async function ensureFixtureIfNeeded(context, plans) {
  if (!plans.some((plan) => plan.execution.needsFixtureServer)) {
    return;
  }

  context.fixture = await launchFixtureServer();
  context.fixtureEnv = buildFixtureEnv(context.fixture);
}

function buildLiveInvocation(plan, context) {
  const { env: launcherEnv, skipReason } = launcherEnvForRuntime(
    plan.execution.runtime,
    context.nativeBinary,
    context.nativeBinaryAvailable,
  );

  if (skipReason) {
    return { skipReason };
  }

  switch (plan.id) {
    case "welcome-banner":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv({
          PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        }),
      };
    case "root-help":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts", "--help"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv(launcherEnv),
      };
    case "guide":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts", "guide"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv(launcherEnv),
      };
    case "capabilities":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts", "--no-banner", "capabilities"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv(launcherEnv),
      };
    case "describe-withdraw-quote":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts", "--no-banner", "describe", "withdraw", "quote"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv(launcherEnv),
      };
    case "init-configured-wallet": {
      const home = createHome("pp-preview-init-");
      const { mnemonicPath, privateKeyPath } = writeSecretFiles(home);
      return {
        command: NODE_BIN,
        args: [
          "--import",
          "tsx",
          "src/index.ts",
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
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv({
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          ...launcherEnv,
        }),
      };
    }
    case "js-activity-global":
    case "native-activity-global":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts", "--no-banner", "activity"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv({
          ...context.fixtureEnv,
          ...launcherEnv,
        }),
      };
    case "js-stats-global":
    case "native-stats-global":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts", "--no-banner", "stats"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv({
          ...context.fixtureEnv,
          ...launcherEnv,
        }),
      };
    case "js-pools-list":
    case "native-pools-list":
      return {
        command: NODE_BIN,
        args: ["--import", "tsx", "src/index.ts", "--no-banner", "pools"],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv({
          ...context.fixtureEnv,
          ...launcherEnv,
        }),
      };
    case "forwarded-pool-detail":
      return {
        command: NODE_BIN,
        args: [
          "--import",
          "tsx",
          "src/index.ts",
          "--no-banner",
          "--chain",
          "sepolia",
          "pools",
          "ETH",
        ],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv({
          ...context.fixtureEnv,
          ...launcherEnv,
        }),
      };
    case "forwarded-status-configured": {
      const home = createHome("pp-preview-status-");
      return {
        command: NODE_BIN,
        args: [
          "--import",
          "tsx",
          "src/index.ts",
          "--no-banner",
          "--chain",
          "sepolia",
          "status",
          "--no-check",
        ],
        displayCommand: plan.execution.commandLabel,
        env: buildChildEnv({
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          ...context.fixtureEnv,
          ...launcherEnv,
        }),
        prepare: async () => {
          await runInitForConfiguredWallet(home, context.fixtureEnv);
        },
      };
    }
    default: {
      if (plan.id.startsWith("flow-status-")) {
        const phase = plan.execution.flowPhase;
        if (!FLOW_STATUS_PREVIEW_PHASES.includes(phase)) {
          throw new Error(`Unknown flow preview phase: ${phase}`);
        }
        const home = createHome(`pp-preview-${phase}-`);
        return {
          command: NODE_BIN,
          args: [
            "--import",
            "tsx",
            "src/index.ts",
            "--no-banner",
            "flow",
            "status",
            "latest",
          ],
          displayCommand: plan.execution.commandLabel,
          env: buildChildEnv({
            PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
            ...launcherEnv,
          }),
          prepare: async () => {
            writeFlowSnapshot(home, createFlowSnapshotForPhase(phase));
          },
        };
      }

      throw new Error(`Unhandled live preview case: ${plan.id}`);
    }
  }
}

function runChildCapture(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    env,
    encoding: "utf8",
    timeout: 120_000,
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

async function executeCapturedCase(plan, context) {
  printCaseHeader(context.writeOut, plan);

  if (plan.execution.kind === "renderer-fixture") {
    const result = runNodeScriptSync(
      "scripts/preview-cli-render-fixture.mjs",
      [plan.execution.fixtureCaseId],
      {},
    );
    writeLine(context.writeOut, `$ ${plan.execution.commandLabel}`);
    writeLine(context.writeOut, `exit ${result.status ?? "null"}`);
    writeBlock(context.writeOut, "--- stderr ---", result.stderr);
    writeBlock(context.writeOut, "--- stdout ---", result.stdout);

    if (result.status !== 0) {
      context.failures.push(
        `${plan.id} exited with ${result.status ?? "null"}${result.errorMessage ? ` (${result.errorMessage})` : ""}`,
      );
    }
    return;
  }

  const invocation = buildLiveInvocation(plan, context);
  if (invocation.skipReason) {
    writeLine(context.writeOut, `Skipped: ${invocation.skipReason}`);
    return;
  }
  if (invocation.prepare) {
    await invocation.prepare();
  }

  const result = runChildCapture(
    invocation.command,
    invocation.args,
    invocation.env,
  );
  writeLine(context.writeOut, `$ ${invocation.displayCommand}`);
  writeLine(context.writeOut, `exit ${result.status ?? "null"}`);
  writeBlock(context.writeOut, "--- stderr ---", result.stderr);
  writeBlock(context.writeOut, "--- stdout ---", result.stdout);

  if (result.status !== 0) {
    context.failures.push(
      `${plan.id} exited with ${result.status ?? "null"}${result.errorMessage ? ` (${result.errorMessage})` : ""}`,
    );
  }
}

export function shouldSkipTtyPreview(io = process) {
  return !io?.stdout?.isTTY || !io?.stdin?.isTTY;
}

function quotePosixShellArg(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildPtyShellInvocation(command, args) {
  if (process.platform === "win32") {
    const escaped = [command, ...args]
      .map((value) =>
        value.includes(" ") || value.includes('"')
          ? `"${value.replace(/"/g, '\\"')}"`
          : value,
      )
      .join(" ");
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", escaped],
    };
  }

  const shell = process.env.SHELL?.trim() || "/bin/zsh";
  const shellCommand = [command, ...args].map(quotePosixShellArg).join(" ");
  return {
    command: shell,
    args: ["-lc", shellCommand],
  };
}

async function runCommandInPty(ptySpawn, invocation, writeOut) {
  try {
    return await runCommandInNodePty(ptySpawn, invocation, writeOut);
  } catch (error) {
    if (!shouldUseScriptPtyFallback(error)) {
      throw error;
    }
    return await runCommandInScriptPty(invocation, writeOut);
  }
}

async function runCommandInNodePty(ptySpawn, invocation, writeOut) {
  return await new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    const shellInvocation = buildPtyShellInvocation(
      invocation.command,
      invocation.args,
    );
    let proc;
    try {
      proc = ptySpawn(shellInvocation.command, shellInvocation.args, {
        name: "xterm-256color",
        cols: process.stdout.columns ?? 120,
        rows: process.stdout.rows ?? 40,
        cwd: ROOT_DIR,
        env: invocation.env,
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }

    proc.onData((chunk) => {
      output += chunk;
      writeOut(chunk);
    });
    proc.onExit(({ exitCode, signal }) => {
      resolvePromise({ exitCode, signal, output });
    });
    proc.on("error", rejectPromise);
  });
}

function shouldUseScriptPtyFallback(error) {
  if (process.platform === "win32") {
    return false;
  }
  return error instanceof Error && error.message.includes("posix_spawnp failed");
}

function sanitizeScriptPtyChunk(value) {
  return value
    .replace(/\u0004/g, "")
    .replace(/\u0008/g, "")
    .replace(/\^D/g, "");
}

async function runCommandInScriptPty(invocation, writeOut) {
  const shellInvocation = buildPtyShellInvocation(
    invocation.command,
    invocation.args,
  );
  return await new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    const proc = spawn(
      "script",
      ["-q", "/dev/null", shellInvocation.command, ...shellInvocation.args],
      {
        cwd: ROOT_DIR,
        env: invocation.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    proc.stdout?.on("data", (chunk) => {
      const value = sanitizeScriptPtyChunk(chunk.toString());
      output += value;
      writeOut(value);
    });
    proc.stderr?.on("data", (chunk) => {
      const value = sanitizeScriptPtyChunk(chunk.toString());
      output += value;
      writeOut(value);
    });
    proc.on("error", rejectPromise);
    proc.on("exit", (exitCode, signal) => {
      resolvePromise({ exitCode, signal, output });
    });
  });
}

async function executeTtyCase(plan, context, ptySpawn) {
  printCaseHeader(context.writeOut, plan);

  let invocation;
  if (plan.execution.kind === "renderer-fixture") {
    invocation = {
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
  } else {
    invocation = buildLiveInvocation(plan, context);
    if (invocation.skipReason) {
      writeLine(context.writeOut, `Skipped: ${invocation.skipReason}`);
      return;
    }
    if (invocation.prepare) {
      await invocation.prepare();
    }
  }

  writeLine(context.writeOut, `$ ${invocation.displayCommand}`);
  const result = await runCommandInPty(ptySpawn, invocation, context.writeOut);
  if (!result.output.endsWith("\n")) {
    writeLine(context.writeOut);
  }
  writeLine(context.writeOut, `exit ${result.exitCode ?? "null"}`);

  if (result.exitCode !== 0) {
    context.failures.push(`${plan.id} exited with ${result.exitCode ?? "null"}`);
  }
}

async function printSuiteIntro(context, plans, mode) {
  writeLine(context.writeOut);
  writeLine(
    context.writeOut,
    `=== Privacy Pools CLI visual preview (${mode}) ===`,
  );
  writeLine(context.writeOut, `Cases: ${plans.length}`);
  writeLine(
    context.writeOut,
    `Native shell: ${context.nativeBinaryAvailable ? context.nativeBinary : "not built"}`,
  );
  if (plans.some((plan) => plan.execution.needsFixtureServer)) {
    writeLine(
      context.writeOut,
      `Fixture server: ${context.fixture ? context.fixture.url : "starting..."}`,
    );
  }
}

export async function runCapturedPreviewSuite(options = {}) {
  const context = createRunContext(options);
  const plans = planPreviewSuite(options.caseIds ?? null);

  if (options.dryRun) {
    return {
      dryRun: true,
      plans,
      nativeBinary: context.nativeBinary,
      nativeBinaryAvailable: context.nativeBinaryAvailable,
      requiresFixtureServer: plans.some((plan) => plan.execution.needsFixtureServer),
    };
  }

  await ensureFixtureIfNeeded(context, plans);
  await printSuiteIntro(context, plans, "captured");

  try {
    for (const plan of plans) {
      await executeCapturedCase(plan, context);
    }
  } finally {
    await killFixtureServer(context.fixture);
  }

  if (context.failures.length > 0) {
    writeLine(
      context.writeErr,
      `Preview finished with ${context.failures.length} failure(s).`,
    );
    for (const failure of context.failures) {
      writeLine(context.writeErr, `- ${failure}`);
    }
  } else {
    writeLine(context.writeOut, "");
    writeLine(context.writeOut, "Preview finished cleanly.");
  }

  return {
    dryRun: false,
    plans,
    failures: [...context.failures],
  };
}

export async function runTtyPreviewSuite(options = {}) {
  const context = createRunContext(options);
  const io = options.io ?? process;

  if (shouldSkipTtyPreview(io)) {
    writeLine(
      context.writeOut,
      "Skipping TTY preview: an interactive terminal is required.",
    );
    return {
      skipped: true,
      plans: [],
      failures: [],
    };
  }

  const plans = planPreviewSuite(options.caseIds ?? null);
  if (options.dryRun) {
    return {
      dryRun: true,
      plans,
      nativeBinary: context.nativeBinary,
      nativeBinaryAvailable: context.nativeBinaryAvailable,
    };
  }

  const ptyModule = options.ptyModule ?? await import("node-pty");
  const ptySpawn = ptyModule.spawn ?? ptyModule.default?.spawn;
  if (typeof ptySpawn !== "function") {
    throw new Error("node-pty does not expose a spawn function.");
  }

  await ensureFixtureIfNeeded(context, plans);
  await printSuiteIntro(context, plans, "tty");

  try {
    for (const plan of plans) {
      await executeTtyCase(plan, context, ptySpawn);
    }
  } finally {
    await killFixtureServer(context.fixture);
  }

  if (context.failures.length > 0) {
    writeLine(
      context.writeErr,
      `TTY preview finished with ${context.failures.length} failure(s).`,
    );
    for (const failure of context.failures) {
      writeLine(context.writeErr, `- ${failure}`);
    }
  } else {
    writeLine(context.writeOut, "");
    writeLine(context.writeOut, "TTY preview finished cleanly.");
  }

  return {
    skipped: false,
    plans,
    failures: [...context.failures],
  };
}
