import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInstalledLauncherBasics,
  currentNativePackageName,
  fail,
  packageInstallPath,
  parseArgs,
  parseJson,
  rootPackageJson,
  runInstalledCli,
  spawnInstalledCli,
  stopInstalledCliChild,
  waitForWorkflowPhase,
  npmCommand,
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
    "Usage: node scripts/verify-release-install.mjs --cli-tarball <path> --native-tarball <path> [--version <version>]\n",
  );
  process.exit(2);
}

function writeInstallProjectManifest(
  installRoot,
  cliTarballPath,
  nativePackageName,
  nativeTarballPath,
) {
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({
      name: "pp-release-install-check",
      private: true,
      dependencies: {
        "privacy-pools-cli": `file:${cliTarballPath}`,
      },
      overrides: {
        [nativePackageName]: `file:${nativeTarballPath}`,
      },
    }),
    "utf8",
  );
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
          `Timed out waiting for installed-artifact ASP fixture.\nstderr:\n${stderr}`,
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
            `Installed-artifact ASP fixture exited before startup (code=${code}, signal=${signal}).\nstderr:\n${stderr}`,
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

const args = parseArgs(process.argv.slice(2));
const cliTarball = args["cli-tarball"]?.trim();
const nativeTarball = args["native-tarball"]?.trim();

if (!cliTarball || !nativeTarball) {
  usageAndExit();
}

const expectedVersion = args.version?.trim() || rootPackageJson.version;
const cliTarballPath = resolve(cliTarball);
const nativeTarballPath = resolve(nativeTarball);
const installRoot = mkdtempSync(join(tmpdir(), "pp-release-install-"));
const npmCacheDir = join(installRoot, ".npm-cache");
const homeDir = join(installRoot, ".privacy-pools");
const stdinHomeDir = join(installRoot, ".privacy-pools-stdin");
const missingWorkerPath = join(installRoot, "missing-worker.js");
const nativePackageName = currentNativePackageName();

if (!nativePackageName) {
  fail(
    `Installed release verification requires a supported native host, got ${process.platform}/${process.arch}.`,
  );
}

async function main() {
  let aspFixture = null;
  try {
    writeInstallProjectManifest(
      installRoot,
      cliTarballPath,
      nativePackageName,
      nativeTarballPath,
    );

    const installResult = spawnSync(
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
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          npm_config_cache: npmCacheDir,
        },
      },
    );

    if (installResult.error) {
      fail(
        `Failed to execute npm install for release tarballs:\n${installResult.error.message}`,
      );
    }

    if (installResult.status !== 0) {
      fail(
        `Failed to install release tarballs:\n${installResult.stderr}\n${installResult.stdout}`,
      );
    }

    const installedNativePackagePath = packageInstallPath(
      installRoot,
      nativePackageName,
    );
    if (!existsSync(installedNativePackagePath)) {
      fail(
        `Installed release CLI did not resolve ${nativePackageName} through npm optional dependencies.`,
      );
    }

    // Resolve the root package's installed bin target from its own package.json.
    // The installed public privacy-pools shim must remain owned by the root JS
    // launcher even when the optional native package is present.
    assertInstalledLauncherBasics({
      installRoot,
      homeDir,
      expectedVersion,
      missingWorkerPath,
      label: "Installed release CLI",
    });

    const initResult = runInstalledCli(
      installRoot,
      stdinHomeDir,
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
        `Installed release CLI failed JS-forwarded init via stdin:\nstatus=${initResult.status}\nstdout=${initResult.stdout}\nstderr=${initResult.stderr}`,
      );
    }
    if (
      initResult.stdout.includes(TEST_PRIVATE_KEY) ||
      initResult.stderr.includes(TEST_PRIVATE_KEY)
    ) {
      fail("Installed release CLI leaked the stdin private key");
    }

    aspFixture = await launchAspFixtureServer();
    const statsSuccessResult = runInstalledCli(
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
    const statsSuccessPayload = parseJson(
      statsSuccessResult.stdout,
      "stats --agent",
    );
    if (
      statsSuccessResult.status !== 0 ||
      statsSuccessPayload.success !== true ||
      statsSuccessPayload.mode !== "global-stats"
    ) {
      fail(
        `Installed release CLI failed native read-only success parity:\nstatus=${statsSuccessResult.status}\nstdout=${statsSuccessResult.stdout}\nstderr=${statsSuccessResult.stderr}`,
      );
    }
    await aspFixture.close();
    aspFixture = null;

    const statusResult = runInstalledCli(
      installRoot,
      stdinHomeDir,
      ["--agent", "status", "--no-check"],
    );
    const statusPayload = parseJson(statusResult.stdout, "status --agent --no-check");
    if (
      statusResult.status !== 0 ||
      statusPayload.success !== true ||
      statusPayload.recoveryPhraseSet !== true ||
      statusPayload.signerKeyValid !== true
    ) {
      fail(
        `Installed release CLI failed JS-forwarded status:\nstatus=${statusResult.status}\nstdout=${statusResult.stdout}\nstderr=${statusResult.stderr}`,
      );
    }

    aspFixture = await launchAspFixtureServer();
    const exportPath = join(installRoot, "installed-flow-wallet.txt");
    const flowStartHandle = spawnInstalledCli(
      installRoot,
      stdinHomeDir,
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
        stdinHomeDir,
        "awaiting_funding",
        {
          child: flowStartHandle.child,
        },
      );
      if (awaitingFunding.walletMode !== "new_wallet") {
        fail(
          `Installed release CLI created an unexpected workflow wallet mode:\n${JSON.stringify(awaitingFunding, null, 2)}`,
        );
      }

      const flowStatusResult = runInstalledCli(
        installRoot,
        stdinHomeDir,
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
          `Installed release CLI failed JS-forwarded flow status parity:\nstatus=${flowStatusResult.status}\nstdout=${flowStatusResult.stdout}\nstderr=${flowStatusResult.stderr}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(
        `Installed release CLI failed JS-forwarded flow setup parity:\n${reason}\nstdout=${flowStartHandle.getStdout()}\nstderr=${flowStartHandle.getStderr()}`,
      );
    } finally {
      await stopInstalledCliChild(flowStartHandle);
      await aspFixture.close();
      aspFixture = null;
    }

    const statsResult = runInstalledCli(
      installRoot,
      homeDir,
      ["--agent", "stats"],
      {
        env: {
          PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
        },
      },
    );
    const statsPayload = parseJson(statsResult.stdout, "stats --agent");
    if (
      statsResult.status !== 3 ||
      statsPayload.success !== false ||
      statsPayload.errorCode !== "RPC_NETWORK_ERROR"
    ) {
      fail(
        `Installed release CLI failed native read-only error parity:\nstatus=${statsResult.status}\nstdout=${statsResult.stdout}\nstderr=${statsResult.stderr}`,
      );
    }

    process.stdout.write(
      `verified installed release artifacts for privacy-pools-cli@${expectedVersion}\n`,
    );
  } finally {
    if (aspFixture) {
      await aspFixture.close();
    }
  }
}

try {
  await main();
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
