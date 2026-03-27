import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function currentNativePackageName(
  platform = process.platform,
  arch = process.arch,
) {
  if (platform === "darwin" && arch === "arm64") {
    return "@0xbow/privacy-pools-cli-native-darwin-arm64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "@0xbow/privacy-pools-cli-native-darwin-x64";
  }
  if (platform === "linux" && arch === "x64") {
    return "@0xbow/privacy-pools-cli-native-linux-x64-gnu";
  }
  if (platform === "win32" && arch === "x64") {
    return "@0xbow/privacy-pools-cli-native-win32-x64-msvc";
  }
  if (platform === "win32" && arch === "arm64") {
    return "@0xbow/privacy-pools-cli-native-win32-arm64-msvc";
  }
  return null;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.split("=", 2);
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
    result[key.slice(2)] = value;
  }
  return result;
}

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/verify-registry-install.mjs [--package <name>] [--version <version>] [--timeout-ms <ms>]\n",
  );
  process.exit(2);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function packageInstallPath(installRoot, packageName) {
  return join(installRoot, "node_modules", ...packageName.split("/"));
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

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`${label} did not emit valid JSON:\n${reason}\n${stdout}`);
  }
}

function resolveInstalledCliCommand(installRoot, args) {
  const binDir = join(installRoot, "node_modules", ".bin");
  if (process.platform === "win32") {
    return {
      command: join(binDir, "privacy-pools.cmd"),
      args,
      shell: true,
    };
  }

  return {
    command: join(binDir, "privacy-pools"),
    args,
    shell: false,
  };
}

function runCli(installRoot, homeDir, args, options = {}) {
  const invocation = resolveInstalledCliCommand(installRoot, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: installRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: invocation.shell,
    env: {
      ...process.env,
      PP_NO_UPDATE_CHECK: "1",
      NO_COLOR: "1",
      PRIVACY_POOLS_HOME: homeDir,
      ...options.env,
    },
    input: options.input,
  });

  if (result.error) {
    fail(
      `Failed to execute privacy-pools ${args.join(" ")}:\n${result.error.message}`,
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

  const versionResult = runCli(installRoot, homeDir, ["--version"]);
  if (versionResult.status !== 0 || versionResult.stdout.trim() !== expectedVersion) {
    fail(
      `Installed registry CLI returned an unexpected version:\nstatus=${versionResult.status}\nstdout=${versionResult.stdout}\nstderr=${versionResult.stderr}`,
    );
  }

  const helpResult = runCli(installRoot, homeDir, ["--help"]);
  if (helpResult.status !== 0 || !helpResult.stdout.includes("privacy-pools")) {
    fail(
      `Installed registry CLI help failed:\nstatus=${helpResult.status}\nstdout=${helpResult.stdout}\nstderr=${helpResult.stderr}`,
    );
  }

  const nativeResolutionResult = runCli(
    installRoot,
    homeDir,
    ["flow", "--help"],
    {
      env: {
        PRIVACY_POOLS_CLI_JS_WORKER: missingWorkerPath,
      },
    },
  );
  if (
    nativeResolutionResult.status !== 0 ||
    !nativeResolutionResult.stdout.includes("Usage: privacy-pools flow")
  ) {
    fail(
      `Installed registry CLI failed native launcher resolution:\nstatus=${nativeResolutionResult.status}\nstdout=${nativeResolutionResult.stdout}\nstderr=${nativeResolutionResult.stderr}`,
    );
  }

  const disabledNativeResolutionResult = runCli(
    installRoot,
    homeDir,
    ["flow", "--help"],
    {
      env: {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        PRIVACY_POOLS_CLI_JS_WORKER: missingWorkerPath,
      },
    },
  );
  if (disabledNativeResolutionResult.status === 0) {
    fail(
      `Installed registry CLI no longer distinguishes native resolution from JS fallback:\nstdout=${disabledNativeResolutionResult.stdout}\nstderr=${disabledNativeResolutionResult.stderr}`,
    );
  }

  const statusResult = runCli(
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
