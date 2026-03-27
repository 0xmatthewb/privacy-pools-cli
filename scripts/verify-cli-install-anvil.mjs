import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const nativeDistributionModulePath = join(
  repoRoot,
  "src",
  "native-distribution.js",
);
const {
  nativePackageNameForTriplet,
  nativeTriplet,
} = await import(pathToFileURL(nativeDistributionModulePath).href);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
// Use a deterministic wallet that does not collide with the shared-Anvil smoke
// wallet, otherwise the installed-artifact deposit can hit PrecommitmentAlreadyUsed.
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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

function currentNativeBinaryPath() {
  const binName =
    process.platform === "win32"
      ? "privacy-pools-cli-native-shell.exe"
      : "privacy-pools-cli-native-shell";
  return join(repoRoot, "native", "shell", "target", "release", binName);
}

function currentNativePackageName(triplet) {
  return nativePackageNameForTriplet(triplet);
}

function readSharedFixtureEnv(sharedEnvFile) {
  try {
    return JSON.parse(readFileSync(resolve(sharedEnvFile), "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `Failed to read shared Anvil fixture env from ${sharedEnvFile}:\n${reason}`,
    );
  }
}

function packTarball(cwd, destinationDir) {
  const packResult = run(npmCommand, ["pack", "--silent"], { cwd });
  const tarballName = packResult.stdout.trim();
  const tarballSource = join(cwd, tarballName);
  const tarballDestination = join(destinationDir, tarballName);
  renameSync(tarballSource, tarballDestination);
  return tarballDestination;
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

function runInstalledCli(installRoot, homeDir, args, options = {}) {
  const invocation = resolveInstalledCliCommand(installRoot, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: installRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
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
      `Failed to execute installed privacy-pools ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  return result;
}

function sharedAnvilCliEnv(sharedEnvFile, env) {
  const suffix = env.chainName.replace(/[^a-z0-9]/gi, "_").toUpperCase();
  return {
    PP_ANVIL_E2E: "1",
    PP_ANVIL_SHARED_ENV_FILE: resolve(sharedEnvFile),
    [`PRIVACY_POOLS_RPC_URL_${suffix}`]: env.rpcUrl,
    PRIVACY_POOLS_ASP_HOST: env.aspUrl,
    PRIVACY_POOLS_RELAYER_HOST: env.relayerUrl,
    PRIVACY_POOLS_CIRCUITS_DIR: env.circuitsDir,
  };
}

const sharedEnvFile = process.env.PP_ANVIL_SHARED_ENV_FILE?.trim();
if (!sharedEnvFile) {
  fail("PP_ANVIL_SHARED_ENV_FILE is required for installed Anvil artifact verification.");
}

const sharedEnv = readSharedFixtureEnv(sharedEnvFile);
const currentTriplet = nativeTriplet();

const distIndexPath = join(repoRoot, "dist", "index.js");
const tempRoot = mkdtempSync(join(tmpdir(), "pp-installed-cli-anvil-"));
const cliTarballDir = join(tempRoot, "cli");
const nativePackageDir = join(tempRoot, "native-package");
const nativeTarballDir = join(tempRoot, "native-tarball");
const installRoot = join(tempRoot, "install");
const homeDir = join(installRoot, ".privacy-pools");
const npmCacheDir = join(tempRoot, ".npm-cache");
const missingWorkerPath = join(installRoot, "missing-worker.js");

mkdirSync(cliTarballDir, { recursive: true });
mkdirSync(nativeTarballDir, { recursive: true });
mkdirSync(installRoot, { recursive: true });

try {
  run(npmCommand, ["run", "build"]);

  if (!existsSync(distIndexPath)) {
    fail("dist/index.js not found after build.");
  }

  if (!currentTriplet) {
    process.stdout.write(
      `Skipping installed CLI + native Anvil verification on unsupported host ${process.platform}/${process.arch}.\n`,
    );
    process.exit(0);
  }

  const cargoCheck = spawnSync(cargoCommand, ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15_000,
  });
  if (cargoCheck.error || cargoCheck.status !== 0) {
    process.stdout.write(
      `Skipping installed CLI + native Anvil verification because cargo is unavailable on ${process.platform}/${process.arch}.\n`,
    );
    process.exit(0);
  }

  run(cargoCommand, [
    "build",
    "--manifest-path",
    "native/shell/Cargo.toml",
    "--release",
  ]);

  const cliTarball = packTarball(repoRoot, cliTarballDir);
  run("node", [
    join(repoRoot, "scripts", "prepare-native-package.mjs"),
    "--triplet",
    currentTriplet,
    "--binary",
    currentNativeBinaryPath(),
    "--out-dir",
    nativePackageDir,
  ]);
  const nativeTarball = packTarball(nativePackageDir, nativeTarballDir);
  const nativePackageName = currentNativePackageName(currentTriplet);
  if (!nativePackageName) {
    fail(`Unsupported native package triplet ${currentTriplet}.`);
  }

  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({
      name: "pp-installed-cli-anvil-check",
      private: true,
      dependencies: {
        "privacy-pools-cli": `file:${cliTarball}`,
      },
      overrides: {
        [nativePackageName]: `file:${nativeTarball}`,
      },
    }),
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

  const installedNativePackagePath = join(
    installRoot,
    "node_modules",
    ...nativePackageName.split("/"),
    "package.json",
  );
  if (!existsSync(installedNativePackagePath)) {
    fail(
      `Installed CLI did not resolve ${nativePackageName} through npm optional dependencies.`,
    );
  }

  const nativeResolutionResult = runInstalledCli(
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
      `Installed CLI failed native resolution parity with optional package installed:\nstatus=${nativeResolutionResult.status}\nstdout=${nativeResolutionResult.stdout}\nstderr=${nativeResolutionResult.stderr}`,
    );
  }

  const disabledNativeResolutionResult = runInstalledCli(
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
      `Installed CLI did not distinguish native resolution from JS fallback:\nstdout=${disabledNativeResolutionResult.stdout}\nstderr=${disabledNativeResolutionResult.stderr}`,
    );
  }

  const initResult = runInstalledCli(
    installRoot,
    homeDir,
    [
      "--agent",
      "init",
      "--mnemonic",
      TEST_MNEMONIC,
      "--private-key",
      TEST_PRIVATE_KEY,
      "--default-chain",
      "sepolia",
      "--yes",
    ],
    { timeout: 60_000 },
  );
  const initPayload = parseJson(initResult.stdout, "installed init --agent");
  if (
    initResult.status !== 0 ||
    initPayload.success !== true ||
    initPayload.defaultChain !== "sepolia"
  ) {
    fail(
      `Installed CLI failed Anvil init parity:\nstatus=${initResult.status}\nstdout=${initResult.stdout}\nstderr=${initResult.stderr}`,
    );
  }

  const anvilEnv = sharedAnvilCliEnv(sharedEnvFile, sharedEnv);

  const depositResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const depositPayload = parseJson(
    depositResult.stdout,
    "installed deposit --agent",
  );
  if (
    depositResult.status !== 0 ||
    depositPayload.success !== true ||
    depositPayload.operation !== "deposit" ||
    typeof depositPayload.poolAccountId !== "string"
  ) {
    fail(
      `Installed CLI failed deposit parity against shared Anvil:\nstatus=${depositResult.status}\nstdout=${depositResult.stdout}\nstderr=${depositResult.stderr}`,
    );
  }

  const ragequitResult = runInstalledCli(
    installRoot,
    homeDir,
    [
      "--agent",
      "ragequit",
      "ETH",
      "--from-pa",
      depositPayload.poolAccountId,
      "--chain",
      "sepolia",
    ],
    {
      env: anvilEnv,
    },
  );
  const ragequitPayload = parseJson(
    ragequitResult.stdout,
    "installed ragequit --agent",
  );
  if (
    ragequitResult.status !== 0 ||
    ragequitPayload.success !== true ||
    ragequitPayload.operation !== "ragequit"
  ) {
    fail(
      `Installed CLI failed ragequit parity against shared Anvil:\nstatus=${ragequitResult.status}\nstdout=${ragequitResult.stdout}\nstderr=${ragequitResult.stderr}`,
    );
  }

  const historyResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "history", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const historyPayload = parseJson(
    historyResult.stdout,
    "installed history --agent",
  );
  if (
    historyResult.status !== 0 ||
    historyPayload.success !== true ||
    !Array.isArray(historyPayload.events) ||
    !historyPayload.events.some(
      (event) =>
        event?.type === "ragequit"
        && event?.poolAccountId === depositPayload.poolAccountId,
    )
  ) {
    fail(
      `Installed CLI failed history parity after ragequit against shared Anvil:\nstatus=${historyResult.status}\nstdout=${historyResult.stdout}\nstderr=${historyResult.stderr}`,
    );
  }

  process.stdout.write(
    `Verified installed CLI and native tarballs against shared Anvil using ${distIndexPath}\n`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
