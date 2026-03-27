import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInstalledLauncherBasics,
  assertInstalledStatusSuccess,
  currentNativePackageName,
  fail,
  npmCommand,
  npmProcessEnv,
  packageInstallPath,
  parseArgs,
  parseJson,
  rootPackageJson,
  runInstalledCli,
  spawnInstalledCli,
  stopInstalledCliChild,
  waitForWorkflowPhase,
  repoRoot,
} from "./lib/install-verification.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_RECIPIENT = "0x4444444444444444444444444444444444444444";

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/verify-registry-install.mjs [--package <name>] [--version <version>] [--timeout-ms <ms>]\n",
  );
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });

  if (result.error) {
    fail(
      `Failed to execute ${command} ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    fail(
      `Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim(),
    );
  }

  return result;
}

async function launchAspFixtureServer() {
  const child = spawn(
    process.execPath,
    [join(scriptDir, "release-install-asp-fixture.mjs")],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const port = await new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const readyTimeout = setTimeout(() => {
      rejectPromise(
        new Error(
          `Timed out waiting for registry-install ASP fixture.\nstderr:\n${stderr}`,
        ),
      );
    }, 10_000);

    const settle = (callback) => {
      clearTimeout(readyTimeout);
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      callback();
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/FIXTURE_PORT=(\d+)/);
      if (match) {
        settle(() => resolvePromise(Number(match[1])));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      settle(() => rejectPromise(error));
    });

    child.once("exit", (code, signal) => {
      settle(() =>
        rejectPromise(
          new Error(
            `Registry-install ASP fixture exited before startup (code=${code}, signal=${signal}).\nstderr:\n${stderr}`,
          ),
        ),
      );
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      await new Promise((resolvePromise) => {
        child.once("exit", () => resolvePromise());
        child.kill("SIGTERM");
      });
    },
  };
}

async function waitForRegistryPackage(packageName, version, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = spawnSync(
      npmCommand,
      ["view", `${packageName}@${version}`, "version"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: npmProcessEnv(installRoot),
      },
    );

    if (result.status === 0 && result.stdout.trim() === version) {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }

  fail(
    `Timed out waiting for ${packageName}@${version} to appear on the npm registry.`,
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usageAndExit();
}

const packageName = args.package?.trim() || rootPackageJson.name;
const expectedVersion = args.version?.trim() || rootPackageJson.version;
const timeoutMs = Number(args["timeout-ms"] ?? "180000");
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  fail(`Invalid --timeout-ms value: ${args["timeout-ms"]}`);
}

const nativePackageName = currentNativePackageName();
if (!nativePackageName) {
  fail(
    `Registry install verification requires a supported native host, got ${process.platform}/${process.arch}.`,
  );
}

const installRoot = mkdtempSync(join(tmpdir(), "pp-registry-install-"));
const homeDir = join(installRoot, ".privacy-pools");
const seededHomeDir = join(installRoot, ".privacy-pools-seeded");
const missingWorkerPath = join(installRoot, "missing-worker.js");

try {
  let aspFixture = null;
  await waitForRegistryPackage(nativePackageName, expectedVersion, timeoutMs);
  await waitForRegistryPackage(packageName, expectedVersion, timeoutMs);

  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify(
      {
        name: "pp-registry-install-check",
        private: true,
        dependencies: {
          [packageName]: expectedVersion,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  run(
    npmCommand,
    [
      "install",
      "--silent",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    {
      cwd: installRoot,
      env: npmProcessEnv(installRoot),
    },
  );

  const installedRootPath = packageInstallPath(installRoot, packageName);
  if (!existsSync(installedRootPath)) {
    fail(`Installed registry package missing: ${packageName}`);
  }

  const installedNativePath = packageInstallPath(installRoot, nativePackageName);
  if (!existsSync(installedNativePath)) {
    fail(
      `Installed registry package did not resolve ${nativePackageName} through npm optional dependencies.`,
    );
  }

  assertInstalledLauncherBasics({
    installRoot,
    homeDir,
    expectedVersion,
    missingWorkerPath,
    label: "Installed registry CLI",
  });

  aspFixture = await launchAspFixtureServer();
  const statsResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "stats"],
    {
      env: {
        PRIVACY_POOLS_ASP_HOST: aspFixture.url,
        PRIVACY_POOLS_CLI_JS_WORKER: missingWorkerPath,
      },
    },
  );
  const statsPayload = parseJson(statsResult.stdout, "stats --agent");
  if (
    statsResult.status !== 0 ||
    statsPayload.success !== true ||
    statsPayload.mode !== "global-stats"
  ) {
    fail(
      `Installed registry CLI failed native read-only success parity:\nstatus=${statsResult.status}\nstdout=${statsResult.stdout}\nstderr=${statsResult.stderr}`,
    );
  }
  await aspFixture.close();
  aspFixture = null;

  const initResult = runInstalledCli(
    installRoot,
    seededHomeDir,
    [
      "--agent",
      "init",
      "--mnemonic",
      TEST_MNEMONIC,
      "--private-key-stdin",
      "--default-chain",
      "sepolia",
      "--yes",
    ],
    {
      input: `${TEST_PRIVATE_KEY}\n`,
      timeout: 60_000,
    },
  );
  const initPayload = parseJson(initResult.stdout, "init --agent");
  if (
    initResult.status !== 0 ||
    initPayload.success !== true ||
    initPayload.defaultChain !== "sepolia"
  ) {
    fail(
      `Installed registry CLI failed JS-forwarded init via stdin:\nstatus=${initResult.status}\nstdout=${initResult.stdout}\nstderr=${initResult.stderr}`,
    );
  }
  if (
    initResult.stdout.includes(TEST_PRIVATE_KEY) ||
    initResult.stderr.includes(TEST_PRIVATE_KEY)
  ) {
    fail("Installed registry CLI leaked the stdin private key");
  }

  assertInstalledStatusSuccess({
    installRoot,
    homeDir: seededHomeDir,
    label: "Installed registry CLI",
  });

  assertInstalledStatusSuccess({
    installRoot,
    homeDir: seededHomeDir,
    label: "Installed registry CLI with native disabled",
    env: {
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
  });

  aspFixture = await launchAspFixtureServer();
  const exportPath = join(installRoot, "registry-flow-wallet.txt");
  const flowStartHandle = spawnInstalledCli(
    installRoot,
    seededHomeDir,
    [
      "--agent",
      "flow",
      "start",
      "100",
      "USDC",
      "--to",
      TEST_RECIPIENT,
      "--new-wallet",
      "--export-new-wallet",
      exportPath,
      "--chain",
      "sepolia",
    ],
    {
      env: {
        PRIVACY_POOLS_ASP_HOST: aspFixture.url,
      },
    },
  );

  try {
    const awaitingFunding = await waitForWorkflowPhase(
      seededHomeDir,
      "awaiting_funding",
      {
        child: flowStartHandle.child,
      },
    );
    if (awaitingFunding.walletMode !== "new_wallet") {
      fail(
        `Installed registry CLI created an unexpected workflow wallet mode:\n${JSON.stringify(awaitingFunding, null, 2)}`,
      );
    }

    const flowStatusResult = runInstalledCli(
      installRoot,
      seededHomeDir,
      ["--agent", "flow", "status", "latest", "--chain", "sepolia"],
      {
        env: {
          PRIVACY_POOLS_ASP_HOST: aspFixture.url,
        },
      },
    );
    const flowStatusPayload = parseJson(
      flowStatusResult.stdout,
      "flow status latest --agent",
    );
    if (
      flowStatusResult.status !== 0 ||
      flowStatusPayload.success !== true ||
      flowStatusPayload.phase !== "awaiting_funding" ||
      flowStatusPayload.walletMode !== "new_wallet"
    ) {
      fail(
        `Installed registry CLI failed JS-forwarded flow status parity:\nstatus=${flowStatusResult.status}\nstdout=${flowStatusResult.stdout}\nstderr=${flowStatusResult.stderr}`,
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `Installed registry CLI failed JS-forwarded flow setup parity:\n${reason}\nstdout=${flowStartHandle.getStdout()}\nstderr=${flowStartHandle.getStderr()}`,
    );
  } finally {
    await stopInstalledCliChild(flowStartHandle);
    await aspFixture.close();
    aspFixture = null;
  }

  const statsErrorResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "stats"],
    {
      env: {
        PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
      },
    },
  );
  const statsErrorPayload = parseJson(
    statsErrorResult.stdout,
    "stats --agent",
  );
  if (
    statsErrorResult.status !== 3 ||
    statsErrorPayload.success !== false ||
    statsErrorPayload.errorCode !== "RPC_NETWORK_ERROR"
  ) {
    fail(
      `Installed registry CLI failed native read-only error parity:\nstatus=${statsErrorResult.status}\nstdout=${statsErrorResult.stdout}\nstderr=${statsErrorResult.stderr}`,
    );
  }

  process.stdout.write(
    `Verified npm registry install for ${packageName}@${expectedVersion} with ${nativePackageName}\n`,
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
