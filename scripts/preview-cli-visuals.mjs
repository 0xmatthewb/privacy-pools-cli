#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

const previewFailures = [];

function wait(ms) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
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
  env.TERM = env.TERM ?? "xterm-256color";
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

function formatCommand(args) {
  return ["privacy-pools", ...args].join(" ");
}

function printSection(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function printBlock(label, value) {
  process.stdout.write(`\n${label}\n`);
  if (!value || value.length === 0) {
    process.stdout.write("(empty)\n");
    return;
  }

  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function runCli(args, options = {}) {
  const result = spawnSync(
    NODE_BIN,
    ["--import", "tsx", "src/index.ts", ...args],
    {
      cwd: ROOT_DIR,
      env: buildChildEnv(options.env),
      encoding: "utf8",
      input: options.input,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    errorMessage: result.error?.message,
  };
}

async function launchFixtureServer() {
  const script = join(ROOT_DIR, "test", "helpers", "fixture-server.ts");
  const proc = spawn(
    NODE_BIN,
    ["--import", "tsx", script],
    {
      cwd: ROOT_DIR,
      env: buildChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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
          cleanup: async () => {
            try {
              proc.kill("SIGTERM");
            } catch {
              // Best effort.
            }
          },
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
        headers: {
          "content-type": "application/json",
        },
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
  // The launcher exits on its own when the parent process ends, but we still
  // send SIGTERM so the preview script leaves no background process behind.
  try {
    fixture.proc.kill("SIGTERM");
  } catch {
    // Best effort.
  }
}

function runPreviewCommand({
  title,
  args,
  env = {},
  home = createHome("pp-preview-home-"),
  input,
  setupHome = false,
  skipIfMissing = false,
  nativeBinary = null,
}) {
  if (skipIfMissing) {
    process.stdout.write(`\n=== ${title} ===\n`);
    process.stdout.write("Skipped: native shell binary not found.\n");
    return;
  }

  if (setupHome) {
    const { mnemonicPath, privateKeyPath } = writeSecretFiles(home);
    const initResult = runCli(
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
          PRIVACY_POOLS_ASP_HOST: env.PRIVACY_POOLS_ASP_HOST,
          PRIVACY_POOLS_RPC_URL_SEPOLIA: env.PRIVACY_POOLS_RPC_URL_SEPOLIA,
        },
      },
    );

    if (initResult.status !== 0) {
      previewFailures.push(`${title}: wallet setup failed`);
      printSection(title);
      printBlock("$ privacy-pools init --agent ...", initResult.stderr || initResult.stdout);
      return;
    }
  }

  const launcherEnv = {
    PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
    ...(nativeBinary
      ? { PRIVACY_POOLS_CLI_BINARY: nativeBinary }
      : { PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1" }),
    ...env,
  };
  const result = runCli(args, {
    env: launcherEnv,
    input,
  });

  printSection(title);
  process.stdout.write(`$ ${formatCommand(args)}\n`);
  process.stdout.write(`exit ${result.status ?? "null"}\n`);
  printBlock("--- stderr ---", result.stderr);
  printBlock("--- stdout ---", result.stdout);

  if (result.status !== 0) {
    previewFailures.push(`${title} exited with ${result.status ?? "null"}`);
  }
}

function previewReadOnlyStates(nativeBinary, env) {
  const readOnlyCases = [
    {
      title: "JS read-only | activity",
      args: ["--no-banner", "activity"],
      env: {
        ...env,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    },
    {
      title: "Native read-only | activity",
      args: ["--no-banner", "activity"],
      env,
      nativeBinary,
    },
    {
      title: "JS read-only | stats",
      args: ["--no-banner", "stats"],
      env: {
        ...env,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    },
    {
      title: "Native read-only | stats",
      args: ["--no-banner", "stats"],
      env,
      nativeBinary,
    },
    {
      title: "JS read-only | pools",
      args: ["--no-banner", "pools"],
      env: {
        ...env,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    },
    {
      title: "Native read-only | pools",
      args: ["--no-banner", "pools"],
      env,
      nativeBinary,
    },
    {
      title: "JS read-only | sepolia pool detail",
      args: ["--no-banner", "--chain", "sepolia", "pools", "ETH"],
      env: {
        ...env,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    },
    {
      title: "Native read-only | sepolia pool detail",
      args: ["--no-banner", "--chain", "sepolia", "pools", "ETH"],
      env,
      nativeBinary,
    },
    {
      title: "JS read-only | filtered activity",
      args: ["--no-banner", "--chain", "sepolia", "activity"],
      env: {
        ...env,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    },
    {
      title: "Native read-only | filtered activity",
      args: ["--no-banner", "--chain", "sepolia", "activity"],
      env,
      nativeBinary,
    },
    {
      title: "JS read-only | sepolia pool stats",
      args: ["--no-banner", "--chain", "sepolia", "stats", "pool", "--asset", "ETH"],
      env: {
        ...env,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    },
    {
      title: "Native read-only | sepolia pool stats",
      args: ["--no-banner", "--chain", "sepolia", "stats", "pool", "--asset", "ETH"],
      env,
      nativeBinary,
    },
  ];

  for (const previewCase of readOnlyCases) {
    runPreviewCommand({
      title: previewCase.title,
      args: previewCase.args,
      env: previewCase.env,
      nativeBinary: previewCase.nativeBinary ?? null,
      skipIfMissing: previewCase.nativeBinary ? !existsSync(previewCase.nativeBinary) : false,
    });
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

function previewWalletAndFlowStates(env) {
  const walletHome = createHome("pp-preview-wallet-");
  runPreviewCommand({
    title: "JS wallet | status snapshot",
    args: ["--no-banner", "--chain", "sepolia", "status", "--no-check"],
    env: {
      ...env,
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
    home: walletHome,
    setupHome: true,
  });

  const flowCases = [
    {
      title: "JS flow | awaiting ASP",
      snapshot: createFlowSnapshot({
        workflowId: "wf-awaiting-asp",
        phase: "awaiting_asp",
        walletMode: "configured",
      }),
    },
    {
      title: "JS flow | waiting privacy delay",
      snapshot: createFlowSnapshot({
        workflowId: "wf-waiting-delay",
        phase: "approved_waiting_privacy_delay",
        privacyDelayUntil: "2026-04-07T18:30:00.000Z",
      }),
    },
    {
      title: "JS flow | paused declined",
      snapshot: createFlowSnapshot({
        workflowId: "wf-declined",
        phase: "paused_declined",
        aspStatus: "declined",
        lastError: {
          step: "asp_review",
          errorCode: "FLOW_DECLINED",
          errorMessage: "The ASP declined this workflow during review.",
          retryable: false,
          at: "2026-03-27T12:05:00.000Z",
        },
      }),
    },
    {
      title: "JS flow | completed",
      snapshot: createFlowSnapshot({
        workflowId: "wf-completed",
        phase: "completed",
        withdrawTxHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        withdrawBlockNumber: "12399",
        withdrawExplorerUrl: "https://example.test/tx/0xbbbbbbbb",
      }),
    },
    {
      title: "JS flow | completed public recovery",
      snapshot: createFlowSnapshot({
        workflowId: "wf-public-recovery",
        phase: "completed_public_recovery",
        ragequitTxHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        ragequitBlockNumber: "12425",
        ragequitExplorerUrl: "https://example.test/tx/0xcccccccc",
      }),
    },
  ];

  for (const flowCase of flowCases) {
    const flowHome = createHome(`pp-preview-${flowCase.snapshot.workflowId}-`);
    writeFlowSnapshot(flowHome, flowCase.snapshot);
    runPreviewCommand({
      title: flowCase.title,
      args: ["--no-banner", "flow", "status", "latest"],
      env: {
        ...env,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
      home: flowHome,
    });
  }
}

async function main() {
  const fixture = await launchFixtureServer();
  const nativeBinary = process.env.PRIVACY_POOLS_CLI_BINARY?.trim() || DEFAULT_NATIVE_BINARY;
  const nativeBinaryAvailable = existsSync(nativeBinary);
  const fixtureEnv = {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_MAINNET: fixture.url,
    PRIVACY_POOLS_RPC_URL_ARBITRUM: fixture.url,
    PRIVACY_POOLS_RPC_URL_OPTIMISM: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
  };

  try {
    printSection("Privacy Pools CLI visual preview");
    process.stdout.write(`Fixture server: ${fixture.url}\n`);
    process.stdout.write(`Native shell: ${nativeBinaryAvailable ? nativeBinary : "not built"}\n`);

    previewReadOnlyStates(nativeBinary, fixtureEnv);
    previewWalletAndFlowStates(fixtureEnv);
  } finally {
    await killFixtureServer(fixture);
  }

  if (previewFailures.length > 0) {
    process.stderr.write(`\nPreview finished with ${previewFailures.length} failure(s).\n`);
    for (const failure of previewFailures) {
      process.stderr.write(`- ${failure}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("\nPreview finished cleanly.\n");
  }
}

await main().catch((error) => {
  process.stderr.write(`Preview harness failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
