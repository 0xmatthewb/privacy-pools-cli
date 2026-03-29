import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertInstalledFlowAwaitingFunding,
  assertInstalledInitViaStdin,
  assertInstalledLauncherBasics,
  assertInstalledPackageVersion,
  assertInstalledNativeStatsError,
  assertInstalledNativeStatsSuccess,
  assertInstalledStatusSuccess,
  currentNativePackageName,
  fail,
  launchAspFixtureServer,
  npmCommand,
  npmProcessEnv,
  packageInstallPath,
  parseJson,
  runNpmInstallWithRetry,
  resolveInstalledDependencyPackagePath,
  parseArgs,
  rootPackageJson,
  repoRoot,
} from "./lib/install-verification.mjs";
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

function resolveGlobalPath(prefix, kind) {
  return run(
    npmCommand,
    [kind, "-g", "--prefix", prefix],
    {
      cwd: prefix,
      env: npmProcessEnv(prefix),
    },
  ).stdout.trim();
}

function globalPackageInstallPath(prefix, packageName) {
  return join(resolveGlobalPath(prefix, "root"), ...packageName.split("/"));
}

function globalBinPath(prefix) {
  return process.platform === "win32"
    ? join(prefix, "privacy-pools.cmd")
    : join(prefix, "bin", "privacy-pools");
}

function runGlobalCli(prefix, homeDir, args, env = {}) {
  const result = spawnSync(globalBinPath(prefix), args, {
    cwd: prefix,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32",
    env: npmProcessEnv(prefix, {
      PP_NO_UPDATE_CHECK: "1",
      NO_COLOR: "1",
      PRIVACY_POOLS_HOME: homeDir,
      npm_config_prefix: prefix,
      ...env,
    }),
  });

  if (result.error) {
    fail(`Failed to execute global privacy-pools CLI:\n${result.error.message}`);
  }

  return result;
}

function assertGlobalLauncherBasics({
  prefix,
  homeDir,
  expectedVersion,
  label,
}) {
  const versionResult = runGlobalCli(prefix, homeDir, ["--version"]);
  if (
    versionResult.status !== 0 ||
    versionResult.stdout.trim() !== expectedVersion ||
    versionResult.stderr.trim() !== ""
  ) {
    fail(
      `${label} returned an unexpected version:\n${versionResult.stderr}\n${versionResult.stdout}`,
    );
  }
}

async function assertGlobalNativeStatsSuccess({
  prefix,
  homeDir,
  label,
  missingWorkerPath,
}) {
  const aspFixture = await launchAspFixtureServer(label);
  try {
    const statsResult = runGlobalCli(
      prefix,
      homeDir,
      ["--agent", "stats"],
      {
        PRIVACY_POOLS_ASP_HOST: aspFixture.url,
        PRIVACY_POOLS_CLI_JS_WORKER: missingWorkerPath,
      },
    );
    const statsPayload = parseJson(
      statsResult.stdout,
      `${label} stats --agent`,
    );
    if (
      statsResult.status !== 0 ||
      statsResult.stderr.trim() !== "" ||
      statsPayload.success !== true ||
      statsPayload.mode !== "global-stats"
    ) {
      fail(
        `${label} failed global npm launcher verification:\n${statsResult.stderr}\n${statsResult.stdout}`,
      );
    }
  } finally {
    await aspFixture.close();
  }
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
const globalPrefix = join(installRoot, "global-prefix");
const globalHomeDir = join(globalPrefix, ".privacy-pools");

try {
  await Promise.all([
    waitForRegistryPackage(nativePackageName, expectedVersion, timeoutMs),
    waitForRegistryPackage(packageName, expectedVersion, timeoutMs),
  ]);

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

  const localInstallResult = runNpmInstallWithRetry(
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
  if (localInstallResult.error) {
    fail(
      `Failed to execute npm install for ${packageName}@${expectedVersion}:\n${localInstallResult.error.message}`,
    );
  }
  if (localInstallResult.status !== 0) {
    fail(
      `Failed to install ${packageName}@${expectedVersion} from npm:\n${localInstallResult.stderr ?? ""}\n${localInstallResult.stdout ?? ""}`.trim(),
    );
  }

  const installedRootPath = packageInstallPath(installRoot, packageName);
  if (!existsSync(installedRootPath)) {
    fail(`Installed registry package missing: ${packageName}`);
  }

  const installedNativePath = resolveInstalledDependencyPackagePath(
    installedRootPath,
    nativePackageName,
  );
  if (!installedNativePath || !existsSync(installedNativePath)) {
    fail(
      `Installed registry package did not resolve ${nativePackageName} through npm optional dependencies.`,
    );
  }
  assertInstalledPackageVersion(
    installedRootPath,
    expectedVersion,
    "Installed registry CLI",
  );
  assertInstalledPackageVersion(
    installedNativePath,
    expectedVersion,
    `Installed registry native package ${nativePackageName}`,
  );

  assertInstalledLauncherBasics({
    installRoot,
    homeDir,
    expectedVersion,
    missingWorkerPath,
    label: "Installed registry CLI",
  });

  await assertInstalledNativeStatsSuccess({
    installRoot,
    homeDir,
    label: "Installed registry CLI",
    missingWorkerPath,
  });

  assertInstalledInitViaStdin({
    installRoot,
    homeDir: seededHomeDir,
    label: "Installed registry CLI",
    mnemonic: TEST_MNEMONIC,
    privateKey: TEST_PRIVATE_KEY,
  });

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

  const exportPath = join(installRoot, "registry-flow-wallet.txt");
  await assertInstalledFlowAwaitingFunding({
    installRoot,
    homeDir: seededHomeDir,
    label: "Installed registry CLI",
    exportPath,
    recipient: TEST_RECIPIENT,
  });

  assertInstalledNativeStatsError({
    installRoot,
    homeDir,
    label: "Installed registry CLI",
  });

  const globalInstallResult = runNpmInstallWithRetry(
    [
      "install",
      "-g",
      "--prefix",
      globalPrefix,
      `${packageName}@${expectedVersion}`,
      "--silent",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    {
      cwd: installRoot,
      env: npmProcessEnv(globalPrefix),
    },
  );
  if (globalInstallResult.error) {
    fail(
      `Failed to execute global npm install for ${packageName}@${expectedVersion}:\n${globalInstallResult.error.message}`,
    );
  }
  if (globalInstallResult.status !== 0) {
    fail(
      `Failed to install ${packageName}@${expectedVersion} globally from npm:\n${globalInstallResult.stderr ?? ""}\n${globalInstallResult.stdout ?? ""}`.trim(),
    );
  }

  const globalCliPath = globalPackageInstallPath(globalPrefix, packageName);
  if (!existsSync(globalCliPath)) {
    fail(`Global installed registry package missing: ${packageName}`);
  }

  const globalNativePath = resolveInstalledDependencyPackagePath(
    globalCliPath,
    nativePackageName,
  );
  if (!globalNativePath || !existsSync(globalNativePath)) {
    fail(
      `Global installed registry package did not resolve ${nativePackageName} through npm optional dependencies.`,
    );
  }

  assertInstalledPackageVersion(
    globalCliPath,
    expectedVersion,
    "Global installed registry CLI",
  );
  assertInstalledPackageVersion(
    globalNativePath,
    expectedVersion,
    `Global installed registry native package ${nativePackageName}`,
  );

  assertGlobalLauncherBasics({
    prefix: globalPrefix,
    homeDir: globalHomeDir,
    expectedVersion,
    label: "Global installed registry CLI",
  });

  await assertGlobalNativeStatsSuccess({
    prefix: globalPrefix,
    homeDir: globalHomeDir,
    label: "Global installed registry CLI",
    missingWorkerPath,
  });

  process.stdout.write(
    `Verified npm registry install for ${packageName}@${expectedVersion} with ${nativePackageName}\n`,
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
