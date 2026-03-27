import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertInstalledFlowAwaitingFunding,
  assertInstalledInitViaStdin,
  assertInstalledLauncherBasics,
  assertInstalledNativeStatsError,
  assertInstalledNativeStatsSuccess,
  assertInstalledStatusSuccess,
  currentNativePackageName,
  fail,
  npmCommand,
  npmProcessEnv,
  packageInstallPath,
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

  process.stdout.write(
    `Verified npm registry install for ${packageName}@${expectedVersion} with ${nativePackageName}\n`,
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
