import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertInstalledInitViaStdin,
  assertInstalledStatusSuccess,
  fail,
  npmCommand,
  npmProcessEnv,
  parseJson,
  parseArgs,
  rootPackageJson,
  runInstalledCli,
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

  const versionResult = runInstalledCli(installRoot, homeDir, ["--version"]);
  if (
    versionResult.status !== 0 ||
    versionResult.stdout.trim() !== expectedVersion ||
    versionResult.stderr.trim() !== ""
  ) {
    fail(
      `Installed root-only CLI returned an unexpected version:\nstatus=${versionResult.status}\nstdout=${versionResult.stdout}\nstderr=${versionResult.stderr}`,
    );
  }

  const welcomeResult = runInstalledCli(installRoot, homeDir, []);
  if (
    welcomeResult.status !== 0 ||
    !welcomeResult.stdout.includes("Explore (no wallet needed)") ||
    !welcomeResult.stdout.includes("Get started:      privacy-pools init") ||
    !welcomeResult.stderr.includes("A compliant way to transact privately on Ethereum.") ||
    welcomeResult.stdout.includes("Running from source?")
  ) {
    fail(
      `Installed root-only CLI bare welcome failed:\nstatus=${welcomeResult.status}\nstdout=${welcomeResult.stdout}\nstderr=${welcomeResult.stderr}`,
    );
  }

  const helpResult = runInstalledCli(installRoot, homeDir, ["--help"]);
  if (
    helpResult.status !== 0 ||
    !helpResult.stdout.includes("privacy-pools") ||
    helpResult.stderr.trim() !== ""
  ) {
    fail(
      `Installed root-only CLI help failed:\nstatus=${helpResult.status}\nstdout=${helpResult.stdout}\nstderr=${helpResult.stderr}`,
    );
  }

  const guideResult = runInstalledCli(installRoot, homeDir, ["--agent", "guide"]);
  const guidePayload = parseJson(guideResult.stdout, "installed root-only guide --agent");
  if (
    guideResult.status !== 0 ||
    guideResult.stderr.trim() !== "" ||
    guidePayload.success !== true ||
    guidePayload.mode !== "help"
  ) {
    fail(
      `Installed root-only CLI guide discovery failed:\nstatus=${guideResult.status}\nstdout=${guideResult.stdout}\nstderr=${guideResult.stderr}`,
    );
  }

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
