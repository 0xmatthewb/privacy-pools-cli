import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_COMMAND_ROUTES } from "../../src/utils/command-routing-static.ts";
import {
  PREVIEW_CASES,
  findPreviewCase,
} from "./preview-cli-catalog.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE_BIN = process.execPath;
const PYTHON_PTY_PROXY = join(ROOT_DIR, "scripts", "lib", "pty-proxy.py");
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

export const PREVIEW_VARIANTS = {
  rich: {
    id: "rich",
    label: "rich",
    env: {
      FORCE_COLOR: "1",
      NO_COLOR: undefined,
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      PRIVACY_POOLS_CLI_PREVIEW_COLUMNS: "120",
      COLUMNS: "120",
    },
    columns: 120,
  },
  "no-color": {
    id: "no-color",
    label: "no-color",
    env: {
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      PRIVACY_POOLS_CLI_PREVIEW_COLUMNS: "120",
      COLUMNS: "120",
    },
    columns: 120,
  },
  ascii: {
    id: "ascii",
    label: "ascii",
    env: {
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      TERM: "dumb",
      LANG: "C",
      LC_ALL: "C",
      PRIVACY_POOLS_CLI_PREVIEW_COLUMNS: "120",
      COLUMNS: "120",
    },
    columns: 120,
  },
  narrow: {
    id: "narrow",
    label: "narrow",
    env: {
      FORCE_COLOR: "1",
      NO_COLOR: undefined,
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      PRIVACY_POOLS_CLI_PREVIEW_COLUMNS: "72",
      COLUMNS: "72",
    },
    columns: 72,
  },
};

const DEFAULT_PREVIEW_VARIANT_IDS = Object.keys(PREVIEW_VARIANTS);
const RUNTIME_DIAGNOSTIC_PREFIX = "[privacy-pools runtime] ";

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

  env.FORCE_COLOR = env.FORCE_COLOR ?? "1";
  env.NODE_NO_WARNINGS = "1";
  env.PP_NO_UPDATE_CHECK = "1";
  env.TERM = env.TERM ?? "xterm-256color";
  env.LANG = env.LANG ?? "en_US.UTF-8";
  env.LC_ALL = env.LC_ALL ?? env.LANG;
  return env;
}

function expectedObservedRouteForPlan(plan) {
  const runtimeTarget = plan.runtimeTarget ?? plan.runtime;
  const runtimeRoute = (() => {
    switch (runtimeTarget) {
      case "native":
        return "native";
      case "forwarded":
        return "forwarded";
      case "js":
      default:
        return "js-runtime";
    }
  })();

  if (plan.surface === "help") {
    return runtimeRoute;
  }

  const route = GENERATED_COMMAND_ROUTES[plan.commandPath];
  if (route?.owner === "native-shell") {
    return "native";
  }
  if (route?.owner === "js-runtime") {
    return "js-runtime";
  }
  if (route?.owner === "hybrid") {
    return runtimeTarget === "native" ? "native" : "forwarded";
  }

  return runtimeRoute;
}

function parseRuntimeDiagnosticLine(line) {
  if (!line.startsWith(RUNTIME_DIAGNOSTIC_PREFIX)) {
    return null;
  }

  const remainder = line.slice(RUNTIME_DIAGNOSTIC_PREFIX.length).trim();
  if (!remainder) {
    return null;
  }

  const [event, ...parts] = remainder.split(/\s+/);
  const payload = {};
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    payload[key] = value;
  }

  return {
    event,
    payload,
  };
}

function resolveObservedRoute(route, kind) {
  if (kind === "spawn-native") {
    return "native";
  }
  if (kind !== "inline-js" && kind !== "spawn-js-worker") {
    return null;
  }

  if (!route || route === "<none>") {
    return "js-runtime";
  }

  const owner = GENERATED_COMMAND_ROUTES[route]?.owner;
  if (owner === "hybrid") {
    return "forwarded";
  }
  return "js-runtime";
}

function extractRuntimeDiagnostics(text) {
  const lines = text.split(/\r?\n/);
  const diagnostics = [];
  const filteredLines = [];

  for (const line of lines) {
    const diagnostic = parseRuntimeDiagnosticLine(line);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    } else {
      filteredLines.push(line);
    }
  }

  const lastWithKind = [...diagnostics]
    .reverse()
    .find((diagnostic) => typeof diagnostic.payload.kind === "string");
  const observedRoute = lastWithKind
    ? resolveObservedRoute(lastWithKind.payload.route, lastWithKind.payload.kind)
    : null;

  return {
    observedRoute,
    diagnostics,
    text: filteredLines.join("\n"),
  };
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

function formatPreviewSectionTitle(plan) {
  const variantLabel = plan.variant ? ` | ${plan.variant.label}` : "";
  return `${plan.journey} | ${plan.label}${variantLabel} [${plan.owner} / ${plan.source}]`;
}

function printCaseHeader(writer, plan) {
  writeLine(writer, "");
  writeLine(writer, `=== ${formatPreviewSectionTitle(plan)} ===`);
  writeLine(writer, `Case ID: ${plan.caseId ?? plan.id}`);
  if (plan.variantId) {
    writeLine(writer, `Variant: ${plan.variantId}`);
  }
  writeLine(writer, `Surface: ${plan.surface}`);
  if (plan.commandPath) {
    writeLine(writer, `Command: ${plan.commandPath}`);
  }
  if (plan.stateId) {
    writeLine(writer, `State: ${plan.stateId} (${plan.stateClass})`);
  }
  writeLine(writer, `Runtime: ${plan.runtime}`);
  writeLine(writer, `Execution: ${plan.executionKind}`);
  writeLine(writer, `Expected exit: ${plan.expectedExitCodes.join(", ")}`);
  writeLine(writer, `Modes: ${formatModeList(plan.modes)}`);
  writeLine(writer, `Covers: ${formatCoverList(plan.covers)}`);
  writeLine(writer, `Setup: ${formatSetupList(plan.requiredSetup)}`);
  writeLine(writer, `Synthetic: ${formatSyntheticReason(plan.syntheticReason)}`);
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
    caseId: previewCase.id,
    execution,
  };
}

function createVariantPlanEntry(plan, variantId) {
  const variant = PREVIEW_VARIANTS[variantId];
  if (!variant) {
    throw new Error(`Unknown preview variant: ${variantId}`);
  }
  return {
    ...plan,
    id: `${plan.caseId}::${variantId}`,
    variantId,
    variant,
  };
}

export function resolvePreviewExecution(caseId) {
  const previewCase = findPreviewCase(caseId);
  if (!previewCase) {
    throw new Error(`Unknown preview case: ${caseId}`);
  }

  const execution = {
    kind: previewCase.executionKind,
    runtime: previewCase.runtime,
    commandLabel: previewCase.preview.commandLabel,
    needsFixtureServer: previewCase.preview.needsFixtureServer,
    buildInvocation: previewCase.preview.buildInvocation,
    fixtureCaseId: previewCase.preview.fixtureCaseId,
    ttyScript: previewCase.preview.ttyScript,
    requiresTtyScript: previewCase.preview.requiresTtyScript === true,
  };

  if (execution.kind !== "live-command" && execution.kind !== "renderer-fixture") {
    throw new Error(`Preview case has an unsupported execution kind: ${caseId}`);
  }

  return createPlanEntry(previewCase, execution);
}

function normalizePlanOptions(options = {}) {
  if (Array.isArray(options) || options === null) {
    return {
      caseIds: options,
      journeys: null,
      commands: null,
      surfaces: null,
      variants: null,
      smoke: false,
    };
  }

  return {
    caseIds: options.caseIds ?? null,
    journeys: options.journeys ?? null,
    commands: options.commands ?? null,
    surfaces: options.surfaces ?? null,
    variants: options.variants ?? null,
    smoke: options.smoke ?? false,
  };
}

function normalizeFilterValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function previewCaseMatchesFilters(previewCase, filters) {
  const journeyFilters = normalizeFilterValues(filters.journeys);
  const commandFilters = normalizeFilterValues(filters.commands);
  const surfaceFilters = normalizeFilterValues(filters.surfaces);

  if (
    journeyFilters &&
    !journeyFilters.includes(previewCase.journey.trim().toLowerCase())
  ) {
    return false;
  }
  if (
    commandFilters &&
    !commandFilters.includes((previewCase.commandPath ?? "").trim().toLowerCase())
  ) {
    return false;
  }
  if (
    surfaceFilters &&
    !surfaceFilters.includes(previewCase.surface.trim().toLowerCase())
  ) {
    return false;
  }
  return true;
}

function resolvePreviewVariantIds(variantIds = null, smoke = false) {
  if (smoke) {
    return ["rich"];
  }
  const resolved = Array.isArray(variantIds) && variantIds.length > 0
    ? variantIds
    : DEFAULT_PREVIEW_VARIANT_IDS;
  for (const variantId of resolved) {
    if (!PREVIEW_VARIANTS[variantId]) {
      throw new Error(`Unknown preview variant: ${variantId}`);
    }
  }
  return [...resolved];
}

function expandPlansForVariants(plans, variantIds) {
  return plans.flatMap((plan) => {
    const requestedVariants = Array.isArray(plan.variantPolicy)
      ? variantIds.filter((variantId) => plan.variantPolicy.includes(variantId))
      : variantIds;
    return requestedVariants.map((variantId) =>
      createVariantPlanEntry(plan, variantId)
    );
  });
}

export function planPreviewSuite(options = {}) {
  const normalized = normalizePlanOptions(options);
  const ids = normalized.caseIds && normalized.caseIds.length > 0
    ? normalized.caseIds
    : PREVIEW_CASES
      .filter((previewCase) => previewCaseMatchesFilters(previewCase, normalized))
      .map((previewCase) => previewCase.id);
  return ids.map((caseId) => resolvePreviewExecution(caseId));
}

export function planPreviewMatrix(options = {}) {
  const normalized = normalizePlanOptions(options);
  const basePlans = planPreviewSuite(normalized);
  return expandPlansForVariants(
    basePlans,
    resolvePreviewVariantIds(normalized.variants, normalized.smoke),
  );
}

export function parsePreviewArgs(argv = process.argv.slice(2)) {
  const caseIds = [];
  const journeys = [];
  const commands = [];
  const surfaces = [];
  const variants = [];
  let listOnly = false;
  let reportJson = false;
  let smoke = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (
      arg === "--case" ||
      arg === "--journey" ||
      arg === "--command" ||
      arg === "--surface" ||
      arg === "--variant"
    ) {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      if (arg === "--case") {
        caseIds.push(value);
      } else if (arg === "--journey") {
        journeys.push(value);
      } else if (arg === "--command") {
        commands.push(value);
      } else if (arg === "--surface") {
        surfaces.push(value);
      } else {
        variants.push(value);
      }
      index += 1;
      continue;
    }
    if (arg === "--list") {
      listOnly = true;
      continue;
    }
    if (arg === "--report-json") {
      reportJson = true;
      continue;
    }
    if (arg === "--smoke") {
      smoke = true;
      continue;
    }
    throw new Error(`Unknown preview argument: ${arg}`);
  }

  return {
    caseIds: caseIds.length > 0 ? caseIds : null,
    journeys: journeys.length > 0 ? journeys : null,
    commands: commands.length > 0 ? commands : null,
    surfaces: surfaces.length > 0 ? surfaces : null,
    variants: variants.length > 0 ? variants : null,
    listOnly,
    reportJson,
    smoke,
  };
}

export function formatPreviewCaseList(options = {}) {
  const plans = planPreviewSuite(options);
  const lines = [
    "id | command | stateId | stateClass | journey | surface | owner | runtime | execution | fidelity | interactive | variants | modes | source | covers | setup | synthetic",
  ];
  for (const plan of plans) {
    lines.push(
      [
        plan.id,
        plan.commandPath ?? "-",
        plan.stateId ?? "-",
        plan.stateClass ?? "-",
        plan.journey,
        plan.surface,
        plan.owner,
        plan.runtime,
        plan.executionKind,
        plan.fidelity ?? "-",
        plan.interactive ? "yes" : "no",
        Array.isArray(plan.variantPolicy) ? plan.variantPolicy.join(", ") : "-",
        formatModeList(plan.modes),
        plan.source,
        formatCoverList(plan.covers),
        formatSetupList(plan.requiredSetup),
        formatSyntheticReason(plan.syntheticReason),
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

function formatModeList(modes) {
  return Array.isArray(modes) && modes.length > 0 ? modes.join(", ") : "-";
}

function formatCoverList(covers) {
  return Array.isArray(covers) && covers.length > 0 ? covers.join(", ") : "-";
}

function formatSetupList(requiredSetup) {
  return Array.isArray(requiredSetup) && requiredSetup.length > 0
    ? requiredSetup.join(", ")
    : "-";
}

function formatSyntheticReason(syntheticReason) {
  return syntheticReason ?? "-";
}

function exitCodeMatchesExpectation(exitCode, expectedExitCodes = [0]) {
  return expectedExitCodes.includes(exitCode ?? -1);
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
    executions: [],
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

function buildPreviewInvocation(plan, context) {
  if (plan.execution.kind === "renderer-fixture") {
    return createPreviewInvocationFromCase(plan, context);
  }

  const invocation = plan.execution.buildInvocation?.(context);
  if (invocation) {
    const resolvedInvocation = {
      ...invocation,
      ttyScript: invocation.ttyScript ?? plan.execution.ttyScript,
      variant: plan.variant,
      env: buildChildEnv({
        PRIVACY_POOLS_DEBUG_RUNTIME: "1",
        PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH: "1",
        ...(invocation.env ?? {}),
        ...(plan.variant?.env ?? {}),
      }),
    };
    if (plan.execution.requiresTtyScript && !resolvedInvocation.ttyScript) {
      throw new Error(
        `TTY preview case ${plan.id} is missing a ttyScript but is marked as requiring one.`,
      );
    }
    return resolvedInvocation;
  }

  if (plan.execution.requiresTtyScript && !plan.execution.ttyScript) {
    throw new Error(
      `TTY preview case ${plan.id} is missing a ttyScript but is marked as requiring one.`,
    );
  }

  return {
    skipReason: `Preview case is missing an invocation builder: ${plan.id}`,
  };
}

function createPreviewInvocationFromCase(plan) {
  return {
    command: NODE_BIN,
    args: [
      "--import",
      "tsx",
      "scripts/preview-cli-render-fixture.mjs",
      plan.execution.fixtureCaseId,
    ],
    displayCommand: plan.execution.commandLabel,
    env: buildChildEnv({
      PRIVACY_POOLS_DEBUG_RUNTIME: "1",
      PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH: "1",
      ...(plan.variant?.env ?? {}),
    }),
    ttyScript: plan.execution.ttyScript,
    variant: plan.variant,
  };
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

function includesPreviewMode(plan, mode) {
  return Array.isArray(plan.modes) && plan.modes.includes(mode);
}

function filterPlansForMode(plans, mode) {
  return plans.filter((plan) => includesPreviewMode(plan, mode));
}

async function executeCapturedCase(plan, context) {
  printCaseHeader(context.writeOut, plan);

  const invocation = buildPreviewInvocation(plan, context);
  if (invocation.skipReason) {
    writeLine(context.writeOut, `Skipped: ${invocation.skipReason}`);
    context.executions.push({
      planId: plan.id,
      caseId: plan.caseId,
      variantId: plan.variantId ?? null,
      mode: "captured",
      status: "skipped",
      skipReason: invocation.skipReason,
    });
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
  const stdoutDiagnostics = extractRuntimeDiagnostics(result.stdout);
  const stderrDiagnostics = extractRuntimeDiagnostics(result.stderr);
  const observedRoute =
    stderrDiagnostics.observedRoute ?? stdoutDiagnostics.observedRoute ?? null;
  writeLine(context.writeOut, `$ ${invocation.displayCommand}`);
  writeLine(context.writeOut, `exit ${result.status ?? "null"}`);
  if (observedRoute) {
    writeLine(
      context.writeOut,
      `Observed route: ${observedRoute} (expected ${expectedObservedRouteForPlan(plan)})`,
    );
  }
  writeBlock(context.writeOut, "--- stderr ---", stderrDiagnostics.text);
  writeBlock(context.writeOut, "--- stdout ---", stdoutDiagnostics.text);

  if (!exitCodeMatchesExpectation(result.status, plan.expectedExitCodes)) {
    context.failures.push(
      `${plan.id} exited with ${result.status ?? "null"} (expected ${plan.expectedExitCodes.join(", ")})${result.errorMessage ? ` (${result.errorMessage})` : ""}`,
    );
    context.executions.push({
      planId: plan.id,
      caseId: plan.caseId,
      variantId: plan.variantId ?? null,
      mode: "captured",
      status: "failed",
      exitCode: result.status ?? null,
      observedRoute,
    });
    return;
  }

  context.executions.push({
    planId: plan.id,
    caseId: plan.caseId,
    variantId: plan.variantId ?? null,
    mode: "captured",
    status: "rendered",
    exitCode: result.status ?? null,
    observedRoute,
  });
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
  if (process.env.PRIVACY_POOLS_CLI_PREVIEW_FORCE_PYTHON_PTY === "1") {
    const result = await runCommandInPythonPty(invocation, writeOut);
    return { ...result, ptyBackend: "python" };
  }

  try {
    const result = await runCommandInNodePty(ptySpawn, invocation, writeOut);
    return { ...result, ptyBackend: "node-pty" };
  } catch (error) {
    if (!shouldUseScriptPtyFallback(error)) {
      throw error;
    }
  }

  try {
    const result = await runCommandInScriptPty(invocation, writeOut);
    if (
      result.exitCode === 1
      && result.output.includes(
        "script: tcgetattr/ioctl: Operation not supported on socket",
      )
    ) {
      const pythonResult = await runCommandInPythonPty(invocation, writeOut);
      return { ...pythonResult, ptyBackend: "python" };
    }
    return { ...result, ptyBackend: "script" };
  } catch (scriptError) {
    if (process.env.PRIVACY_POOLS_CLI_PREVIEW_ALLOW_PYTHON_PTY !== "1") {
      throw scriptError;
    }
    const result = await runCommandInPythonPty(invocation, writeOut);
    return { ...result, ptyBackend: "python" };
  }
}

function normalizeTtyScript(script) {
  if (!script) {
    return null;
  }

  return {
    timeoutMs: script.timeoutMs ?? 15_000,
    finalPauseMs: script.finalPauseMs ?? 0,
    steps: Array.isArray(script.steps) ? script.steps : [],
  };
}

async function waitForTtyOutput(readOutput, pattern, timeoutMs, isDone) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readOutput().includes(pattern)) {
      return;
    }
    if (typeof isDone === "function" && isDone()) {
      throw new Error(
        `TTY preview command exited before the expected prompt appeared: ${pattern}`,
      );
    }
    await wait(50);
  }

  throw new Error(`TTY preview script timed out waiting for: ${pattern}`);
}

async function driveTtyScript(io, ttyScript, readOutput, isDone) {
  const script = normalizeTtyScript(ttyScript);
  if (!script || script.steps.length === 0) {
    return;
  }

  for (const step of script.steps) {
    if (step.waitFor) {
      await waitForTtyOutput(
        readOutput,
        step.waitFor,
        script.timeoutMs,
        isDone,
      );
    }
    if (step.pauseMs) {
      await wait(step.pauseMs);
    }
    if (step.send) {
      io.write(step.send);
    }
  }

  if (script.finalPauseMs > 0) {
    await wait(script.finalPauseMs);
  }
}

async function runCommandInNodePty(ptySpawn, invocation, writeOut) {
  return await new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    let failed = false;
    let exited = false;
    const shellInvocation = buildPtyShellInvocation(
      invocation.command,
      invocation.args,
    );
    let proc;
    try {
      proc = ptySpawn(shellInvocation.command, shellInvocation.args, {
        name: "xterm-256color",
        cols: invocation.variant?.columns ?? process.stdout.columns ?? 120,
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
    void driveTtyScript(
      { write: (value) => proc.write(value) },
      invocation.ttyScript,
      () => output,
      () => exited,
    ).catch((error) => {
      failed = true;
      rejectPromise(error);
      try {
        proc.kill();
      } catch {
        // Best effort.
      }
    });
    proc.onExit(({ exitCode, signal }) => {
      exited = true;
      if (failed) {
        return;
      }
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

async function runCommandInPythonPty(invocation, writeOut) {
  const shellInvocation = buildPtyShellInvocation(
    invocation.command,
    invocation.args,
  );
  const payload = JSON.stringify({
    command: shellInvocation.command,
    args: shellInvocation.args,
    cwd: ROOT_DIR,
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    let failed = false;
    let exited = false;
    const proc = spawn("python3", ["-u", PYTHON_PTY_PROXY, payload], {
      cwd: ROOT_DIR,
      env: invocation.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    void driveTtyScript(
      {
        write: (value) => {
          proc.stdin?.write(value);
        },
      },
      invocation.ttyScript,
      () => output,
      () => exited,
    ).catch((error) => {
      failed = true;
      rejectPromise(error);
      try {
        proc.kill("SIGTERM");
      } catch {
        // Best effort.
      }
    });

    const onChunk = (chunk) => {
      const value = chunk.toString();
      output += value;
      writeOut(value);
    };

    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);
    proc.on("error", rejectPromise);
    proc.on("exit", (exitCode, signal) => {
      exited = true;
      if (failed) {
        return;
      }
      resolvePromise({ exitCode, signal, output });
    });
  });
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
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let failed = false;
    let exited = false;
    void driveTtyScript(
      {
        write: (value) => {
          proc.stdin?.write(value);
        },
      },
      invocation.ttyScript,
      () => output,
      () => exited,
    ).catch((error) => {
      failed = true;
      rejectPromise(error);
      try {
        proc.kill("SIGTERM");
      } catch {
        // Best effort.
      }
    });

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
      exited = true;
      if (failed) {
        return;
      }
      resolvePromise({ exitCode, signal, output });
    });
  });
}

async function executeTtyCase(plan, context, ptySpawn) {
  printCaseHeader(context.writeOut, plan);

  const invocation = buildPreviewInvocation(plan, context);
  if (invocation.skipReason) {
    writeLine(context.writeOut, `Skipped: ${invocation.skipReason}`);
    context.executions.push({
      planId: plan.id,
      caseId: plan.caseId,
      variantId: plan.variantId ?? null,
      mode: "tty",
      status: "skipped",
      skipReason: invocation.skipReason,
    });
    return;
  }
  if (invocation.prepare) {
    await invocation.prepare();
  }

  writeLine(context.writeOut, `$ ${invocation.displayCommand}`);
  let rawOutput = "";
  const result = await runCommandInPty(ptySpawn, invocation, (chunk) => {
    rawOutput += chunk;
  });
  const diagnostics = extractRuntimeDiagnostics(rawOutput);
  if (diagnostics.text.length > 0) {
    context.writeOut(diagnostics.text);
  }
  if (diagnostics.observedRoute) {
    writeLine(
      context.writeOut,
      `Observed route: ${diagnostics.observedRoute} (expected ${expectedObservedRouteForPlan(plan)})`,
    );
  }
  writeLine(context.writeOut, `PTY backend: ${result.ptyBackend}`);
  if (diagnostics.text.length > 0 && !diagnostics.text.endsWith("\n")) {
    writeLine(context.writeOut);
  }
  writeLine(context.writeOut, `exit ${result.exitCode ?? "null"}`);

  if (!exitCodeMatchesExpectation(result.exitCode, plan.expectedExitCodes)) {
    context.failures.push(
      `${plan.id} exited with ${result.exitCode ?? "null"} (expected ${plan.expectedExitCodes.join(", ")})`,
    );
    context.executions.push({
      planId: plan.id,
      caseId: plan.caseId,
      variantId: plan.variantId ?? null,
      mode: "tty",
      status: "failed",
      exitCode: result.exitCode ?? null,
      observedRoute: diagnostics.observedRoute,
      ptyBackend: result.ptyBackend,
    });
    return;
  }

  context.executions.push({
    planId: plan.id,
    caseId: plan.caseId,
    variantId: plan.variantId ?? null,
    mode: "tty",
    status: "rendered",
    exitCode: result.exitCode ?? null,
    observedRoute: diagnostics.observedRoute,
    ptyBackend: result.ptyBackend,
  });
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
    `Variants: ${
      [...new Set(plans.map((plan) => plan.variantId).filter(Boolean))].join(", ") || "-"
    }`,
  );
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
  const plans = filterPlansForMode(
    planPreviewMatrix(options),
    "captured",
  );

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
      executions: [...context.executions],
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

  const plans = filterPlansForMode(
    planPreviewMatrix(options),
    "tty",
  );
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
    executions: [...context.executions],
  };
}

function stateKeyForPlan(plan) {
  return [
    plan.commandPath ?? "-",
    plan.stateId ?? plan.caseId ?? plan.id,
    plan.runtimeTarget ?? plan.runtime,
  ].join("::");
}

export function createPreviewCoverageReport({
  capturedResult = null,
  ttyResult = null,
  artifactPaths = {},
  batchId = null,
  batches = [],
} = {}) {
  const results = [capturedResult, ttyResult].filter(Boolean);
  const plans = results.flatMap((result) => result.plans ?? []);
  const executions = results.flatMap((result) => result.executions ?? []);
  const expectedPlanIds = new Set(plans.map((plan) => plan.id));
  const renderedPlanIds = new Set(
    executions
      .filter((execution) => execution.status === "rendered")
      .map((execution) => execution.planId),
  );
  const skippedExecutions = executions.filter(
    (execution) => execution.status === "skipped",
  );
  const failedExecutions = executions.filter(
    (execution) => execution.status === "failed",
  );
  const unexpectedObservedRoutes = executions.filter((execution) => {
    if (execution.status !== "rendered") return false;
    const plan = plans.find((candidate) => candidate.id === execution.planId);
    if (!plan) return false;
    if (plan.executionKind !== "live-command") return false;
    return execution.observedRoute !== expectedObservedRouteForPlan(plan);
  });
  const stateMap = new Map(plans.map((plan) => [plan.id, stateKeyForPlan(plan)]));
  const expectedStates = new Set(plans.map((plan) => stateKeyForPlan(plan)));
  const renderedStates = new Set(
    [...renderedPlanIds]
      .map((planId) => stateMap.get(planId))
      .filter(Boolean),
  );
  const missingStates = [...expectedStates].filter(
    (stateKey) => !renderedStates.has(stateKey),
  );

  const fidelityCounts = {};
  for (const plan of plans) {
    const key = plan.fidelity ?? "unknown";
    fidelityCounts[key] = (fidelityCounts[key] ?? 0) + 1;
  }

  const observedRouteCounts = {};
  const ptyBackendCounts = {};
  for (const execution of executions) {
    if (execution.observedRoute) {
      observedRouteCounts[execution.observedRoute] =
        (observedRouteCounts[execution.observedRoute] ?? 0) + 1;
    }
    if (execution.ptyBackend) {
      ptyBackendCounts[execution.ptyBackend] =
        (ptyBackendCounts[execution.ptyBackend] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    batchId,
    batches,
    summary: {
      expectedPlans: expectedPlanIds.size,
      renderedPlans: renderedPlanIds.size,
      skippedPlans: skippedExecutions.length,
      failedPlans: failedExecutions.length,
      expectedStates: expectedStates.size,
      renderedStates: renderedStates.size,
      missingStates: missingStates.length,
      unexpectedObservedRoutes: unexpectedObservedRoutes.length,
    },
    expectedStates: [...expectedStates].sort(),
    renderedStates: [...renderedStates].sort(),
    missingStates: missingStates.sort(),
    liveVsFixtureRatio: fidelityCounts,
    observedRoutes: observedRouteCounts,
    ptyBackends: ptyBackendCounts,
    unexpectedObservedRoutes,
    failures: failedExecutions,
    skips: skippedExecutions,
    artifactPaths,
  };
}

export function formatPreviewCoverageReportMarkdown(report) {
  const lines = [
    "# Preview Coverage Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    `- Expected plans: ${report.summary.expectedPlans}`,
    `- Rendered plans: ${report.summary.renderedPlans}`,
    `- Skipped plans: ${report.summary.skippedPlans}`,
    `- Failed plans: ${report.summary.failedPlans}`,
    `- Expected states: ${report.summary.expectedStates}`,
    `- Rendered states: ${report.summary.renderedStates}`,
    `- Missing states: ${report.summary.missingStates}`,
    `- Unexpected observed routes: ${report.summary.unexpectedObservedRoutes}`,
    "",
    "## Fidelity",
  ];

  if (report.batchId) {
    lines.splice(4, 0, `Batch: ${report.batchId}`, "");
  }

  for (const [fidelity, count] of Object.entries(report.liveVsFixtureRatio)) {
    lines.push(`- ${fidelity}: ${count}`);
  }

  if (Object.keys(report.observedRoutes ?? {}).length > 0) {
    lines.push("", "## Observed Routes");
    for (const [route, count] of Object.entries(report.observedRoutes)) {
      lines.push(`- ${route}: ${count}`);
    }
  }

  if (Object.keys(report.ptyBackends ?? {}).length > 0) {
    lines.push("", "## PTY Backends");
    for (const [backend, count] of Object.entries(report.ptyBackends)) {
      lines.push(`- ${backend}: ${count}`);
    }
  }

  if (report.missingStates.length > 0) {
    lines.push("", "## Missing States");
    for (const state of report.missingStates) {
      lines.push(`- ${state}`);
    }
  }

  if (report.failures.length > 0) {
    lines.push("", "## Failures");
    for (const failure of report.failures) {
      lines.push(
        `- ${failure.planId} (${failure.mode}${failure.variantId ? ` / ${failure.variantId}` : ""})`,
      );
    }
  }

  if (report.unexpectedObservedRoutes?.length > 0) {
    lines.push("", "## Route Mismatches");
    for (const mismatch of report.unexpectedObservedRoutes) {
      lines.push(
        `- ${mismatch.planId} (${mismatch.mode}${mismatch.variantId ? ` / ${mismatch.variantId}` : ""}): observed ${mismatch.observedRoute ?? "unknown"}`,
      );
    }
  }

  if (report.skips.length > 0) {
    lines.push("", "## Skips");
    for (const skip of report.skips) {
      lines.push(
        `- ${skip.planId} (${skip.mode}${skip.variantId ? ` / ${skip.variantId}` : ""}): ${skip.skipReason}`,
      );
    }
  }

  if (Object.keys(report.artifactPaths).length > 0) {
    lines.push("", "## Artifacts");
    for (const [label, value] of Object.entries(report.artifactPaths)) {
      lines.push(`- ${label}: ${value}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
