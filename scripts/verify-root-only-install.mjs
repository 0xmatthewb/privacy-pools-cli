import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertInstalledLauncherBasics,
  assertInstalledInitViaStdin,
  assertInstalledStatusSuccess,
  fail,
  npmCommand,
  npmProcessEnv,
  parseArgs,
  rootPackageJson,
} from "./lib/install-verification.mjs";
import { spawnSync } from "node:child_process";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/verify-root-only-install.mjs --cli-tarball <path> [--version <version>]\n",
  );
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const cliTarball = args["cli-tarball"]?.trim();

if (!cliTarball) {
  usageAndExit();
}

const expectedVersion = args.version?.trim() || rootPackageJson.version;
const cliTarballPath = resolve(cliTarball);
const installRoot = mkdtempSync(join(tmpdir(), "pp-root-install-"));
const homeDir = join(installRoot, ".privacy-pools");

try {
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify(
      {
        name: "pp-root-install-check",
        private: true,
        dependencies: {
          "privacy-pools-cli": `file:${cliTarballPath}`,
        },
      },
      null,
      2,
    ),
    "utf8",
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
      "--omit=optional",
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
      `Failed to execute npm install for the root-only CLI tarball:\n${installResult.error.message}`,
    );
  }

  if (installResult.status !== 0) {
    fail(
      `Failed to install the root-only CLI tarball:\n${installResult.stderr}\n${installResult.stdout}`,
    );
  }

  assertInstalledLauncherBasics({
    installRoot,
    homeDir,
    expectedVersion,
    label: "Installed root-only CLI",
  });

  assertInstalledInitViaStdin({
    installRoot,
    homeDir,
    label: "Installed root-only CLI",
    mnemonic: TEST_MNEMONIC,
    privateKey: TEST_PRIVATE_KEY,
  });

  assertInstalledStatusSuccess({
    installRoot,
    homeDir,
    label: "Installed root-only CLI",
  });

  assertInstalledStatusSuccess({
    installRoot,
    homeDir,
    label: "Installed root-only CLI with native disabled",
    env: {
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
  });

  process.stdout.write(
    `verified installed root-only release artifact for privacy-pools-cli@${expectedVersion}\n`,
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
