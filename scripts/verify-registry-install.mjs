import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertInstalledLauncherBasics,
  currentNativePackageName,
  fail,
  npmCommand,
  packageInstallPath,
  parseArgs,
  parseJson,
  rootPackageJson,
  runInstalledCli,
  repoRoot,
} from "./lib/install-verification.mjs";

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
const npmCacheDir = join(installRoot, ".npm-cache");
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
      env: {
        ...process.env,
        npm_config_cache: npmCacheDir,
      },
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

  const statusResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "status", "--no-check"],
  );
  const statusPayload = parseJson(
    statusResult.stdout,
    "status --agent --no-check",
  );
  if (
    statusResult.status !== 0 ||
    statusPayload.success !== true ||
    statusPayload.recoveryPhraseSet !== false
  ) {
    fail(
      `Installed registry CLI failed JS-forwarded status:\nstatus=${statusResult.status}\nstdout=${statusResult.stdout}\nstderr=${statusResult.stderr}`,
    );
  }

  process.stdout.write(
    `Verified npm registry install for ${packageName}@${expectedVersion} with ${nativePackageName}\n`,
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
