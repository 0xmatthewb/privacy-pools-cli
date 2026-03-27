import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertInstalledFlowAwaitingFunding,
  assertInstalledInitViaStdin,
  assertInstalledLauncherBasics,
  assertInstalledNativeStatsError,
  assertInstalledNativeStatsSuccess,
  assertInstalledStatusSuccess,
  currentNativePackageName,
  fail,
  packageInstallPath,
  parseArgs,
  rootPackageJson,
  npmCommand,
  npmProcessEnv,
} from "./lib/install-verification.mjs";
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
      env: npmProcessEnv(installRoot),
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

  assertInstalledInitViaStdin({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI",
    mnemonic: TEST_MNEMONIC,
    privateKey: TEST_PRIVATE_KEY,
  });

  await assertInstalledNativeStatsSuccess({
    installRoot,
    homeDir,
    label: "Installed release CLI",
    missingWorkerPath,
  });

  assertInstalledStatusSuccess({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI",
  });

  assertInstalledStatusSuccess({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI with native disabled",
    env: {
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
  });

  const exportPath = join(installRoot, "installed-flow-wallet.txt");
  await assertInstalledFlowAwaitingFunding({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI",
    exportPath,
    recipient: TEST_RECIPIENT,
  });

  assertInstalledNativeStatsError({
    installRoot,
    homeDir,
    label: "Installed release CLI",
  });

  process.stdout.write(
    `verified installed release artifacts for privacy-pools-cli@${expectedVersion}\n`,
  );
}

try {
  await main();
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
