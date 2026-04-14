import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = dirname(dirname(libDir));
const INSTALL_ASP_FIXTURE = join(
  repoRoot,
  "scripts",
  "release-install-asp-fixture.mjs",
);
export const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
export const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
export const supportedInstallNodeRange = rootPackageJson.engines?.node ?? ">=22 <26";
const STRIPPED_INSTALL_ENV_PREFIXES = ["PRIVACY_POOLS_", "PP_"];
const NPM_INSTALL_RETRY_DELAYS_MS = [1_000, 2_000];
const RETRIABLE_NPM_INSTALL_PATTERNS = [
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "socket hang up",
  "network timeout",
];

const nativeDistributionModulePath = join(
  repoRoot,
  "src",
  "native-distribution.js",
);
const { nativePackageName: resolveNativePackageName } = await import(
  pathToFileURL(nativeDistributionModulePath).href
);

export function parseArgs(argv) {
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

export function resolveCliTarballPath(
  parsedArgs,
  fallbackPath = null,
) {
  const explicitPath = parsedArgs?.["cli-tarball"]?.trim();
  const candidate = explicitPath || fallbackPath;
  return candidate ? resolve(candidate) : null;
}

export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const PRIVATE_KEY_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g;
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s'")]+/gi;

export function redactSensitiveText(text, secrets = []) {
  let redacted = String(text)
    .replace(PRIVATE_KEY_PATTERN, "<redacted-private-key>")
    .replace(URL_PATTERN, "<redacted-url>");

  for (const secret of secrets) {
    if (!secret) continue;
    redacted = redacted.split(secret).join("<redacted-secret>");
  }

  return redacted;
}

export function previewOutput(text, secrets = []) {
  const sanitized = redactSensitiveText(text, secrets).trim();
  if (!sanitized) return "<empty>";
  if (sanitized.length <= 600) return sanitized;
  return `${sanitized.slice(0, 600)}\n<truncated>`;
}

export function formatResultDiagnostics(result, secrets = []) {
  return [
    `status=${result.status}`,
    `signal=${result.signal ?? "<none>"}`,
    `stdout=${previewOutput(result.stdout ?? "", secrets)}`,
    `stderr=${previewOutput(result.stderr ?? "", secrets)}`,
  ].join("\n");
}

export function buildInstallBaseEnv(
  baseEnv = process.env,
  overrides = {},
) {
  const nextEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (
      STRIPPED_INSTALL_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      continue;
    }
    nextEnv[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete nextEnv[key];
    } else {
      nextEnv[key] = value;
    }
  }

  return nextEnv;
}

export function currentNativePackageName(
  platform = process.platform,
  arch = process.arch,
) {
  return resolveNativePackageName(platform, arch);
}

export function supportedInstallNodeMajor(version = process.versions.node) {
  const normalized = String(version).replace(/^v/, "");
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export function isSupportedInstallNodeVersion(version = process.versions.node) {
  const major = supportedInstallNodeMajor(version);
  return major !== null && major >= 22 && major < 26;
}

export function unsupportedInstallNodeMessage(
  label = "Installed-artifact verification",
  version = process.version,
) {
  return `${label} skipped because the current host runtime ${version} is outside the supported Node.js range ${supportedInstallNodeRange}.`;
}

export function npmProcessEnv(stateRoot, env = {}) {
  return buildInstallBaseEnv(process.env, {
    npm_config_cache: join(stateRoot, ".npm-cache"),
    npm_config_userconfig: join(stateRoot, ".npmrc"),
    npm_config_update_notifier: "false",
    ...env,
  });
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function isRetriableNpmInstallFailure(result) {
  const haystack = [
    result.error?.message,
    result.stderr,
    result.stdout,
  ]
    .filter(Boolean)
    .join("\n");

  if (
    haystack.length === 0
    && (
      result.signal
      || (typeof result.status === "number" && result.status !== 0)
    )
  ) {
    return true;
  }

  return RETRIABLE_NPM_INSTALL_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export function runNpmInstallWithRetry(args, options = {}) {
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const sleepImpl = options.sleepImpl ?? sleepMs;

  let lastResult = null;
  for (let attempt = 0; attempt <= NPM_INSTALL_RETRY_DELAYS_MS.length; attempt += 1) {
    const result = spawnSyncImpl(npmCommand, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeout ?? 180_000,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      env: options.env,
    });

    if (!result.error && result.status === 0) {
      return result;
    }

    lastResult = result;
    if (
      attempt >= NPM_INSTALL_RETRY_DELAYS_MS.length
      || !isRetriableNpmInstallFailure(result)
    ) {
      return result;
    }

    sleepImpl(NPM_INSTALL_RETRY_DELAYS_MS[attempt]);
  }

  return lastResult;
}

export function packTarball(cwd, destinationDir, options = {}) {
  mkdirSync(destinationDir, { recursive: true });
  const packArgs = ["pack", resolve(cwd), "--silent"];
  if (options.ignoreScripts) {
    packArgs.push("--ignore-scripts");
  }
  const packResult = spawnSync(npmCommand, packArgs, {
    cwd: destinationDir,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    env: npmProcessEnv(options.npmStateRoot ?? destinationDir, options.env),
  });

  if (packResult.error) {
    fail(
      `Failed to execute ${npmCommand} ${packArgs.join(" ")}:\n${packResult.error.message}`,
    );
  }

  if (packResult.status !== 0) {
    fail(
      `Command failed: ${npmCommand} ${packArgs.join(" ")}\n${packResult.stderr ?? ""}\n${packResult.stdout ?? ""}`.trim(),
    );
  }

  const tarballName = packResult.stdout.trim();
  return join(destinationDir, tarballName);
}

export function packageInstallPath(installRoot, packageName) {
  return join(installRoot, "node_modules", ...packageName.split("/"));
}

export function resolveInstalledDependencyPackagePath(
  installedRootPackagePath,
  packageName,
) {
  try {
    const requireResolve = createRequire(
      join(installedRootPackagePath, "package.json"),
    ).resolve;
    return dirname(requireResolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
}

export function readInstalledPackageManifest(packageRoot, label) {
  const packageJsonPath = join(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    fail(`${label} package.json is missing at ${packageJsonPath}.`);
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`${label} package.json is invalid JSON:\n${reason}`);
  }
}

export function assertInstalledPackageVersion(
  packageRoot,
  expectedVersion,
  label,
) {
  const manifest = readInstalledPackageManifest(packageRoot, label);
  const actualVersion =
    typeof manifest.version === "string" ? manifest.version.trim() : "";

  if (actualVersion !== expectedVersion) {
    fail(
      `${label} package.json version ${actualVersion || "<missing>"} did not match ${expectedVersion}.`,
    );
  }

  return manifest;
}

export function parseJson(stdout, label, secrets = []) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `${label} did not emit valid JSON:\n${reason}\nstdout=${previewOutput(stdout, secrets)}`,
    );
  }
}

export function resolveInstalledCliCommand(installRoot, args) {
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

export function installCliEnv(homeDir, env = {}) {
  return buildInstallBaseEnv(process.env, {
    PP_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    PRIVACY_POOLS_HOME: homeDir,
    TERM_SESSION_ID: undefined,
    ITERM_SESSION_ID: undefined,
    ...env,
  });
}

export function runInstalledCli(installRoot, homeDir, args, options = {}) {
  const invocation = resolveInstalledCliCommand(installRoot, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: installRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: invocation.shell,
    env: installCliEnv(homeDir, options.env),
    input: options.input,
  });

  if (result.error) {
    fail(`Failed to execute privacy-pools invocation:\n${result.error.message}`);
  }

  return result;
}

export function writeInstallSecretFile(homeDir, fileName, content) {
  mkdirSync(homeDir, { recursive: true });
  const filePath = join(homeDir, fileName);
  writeFileSync(filePath, `${content}\n`, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

export async function launchAspFixtureServer(label = "installed-artifact") {
  const child = spawn(process.execPath, [INSTALL_ASP_FIXTURE], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const port = await new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const readyTimeout = setTimeout(() => {
      rejectPromise(
        new Error(
          `Timed out waiting for ${label} ASP fixture.\nstderr:\n${stderr}`,
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
            `${label} ASP fixture exited before startup (code=${code}, signal=${signal}).\nstderr:\n${stderr}`,
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

export function spawnInstalledCli(installRoot, homeDir, args, options = {}) {
  const invocation = resolveInstalledCliCommand(installRoot, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: installRoot,
    shell: invocation.shell,
    stdio: ["ignore", "pipe", "pipe"],
    env: installCliEnv(homeDir, options.env),
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return {
    child,
    getStdout() {
      return stdout;
    },
    getStderr() {
      return stderr;
    },
  };
}

export async function stopInstalledCliChild(handle) {
  const { child } = handle;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    child.kill("SIGINT");
  });
}

export function readLatestWorkflowSnapshot(homeDir) {
  const workflowsDir = join(homeDir, "workflows");
  if (!existsSync(workflowsDir)) {
    return null;
  }

  const snapshots = readdirSync(workflowsDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      const filePath = join(workflowsDir, entry);
      try {
        const snapshot = JSON.parse(readFileSync(filePath, "utf8"));
        const updatedAt =
          typeof snapshot.updatedAt === "string"
            ? Date.parse(snapshot.updatedAt)
            : Number.NaN;
        const createdAt =
          typeof snapshot.createdAt === "string"
            ? Date.parse(snapshot.createdAt)
            : Number.NaN;
        const timestamp = Number.isFinite(updatedAt)
          ? updatedAt
          : Number.isFinite(createdAt)
            ? createdAt
            : statSync(filePath).mtimeMs;
        return { snapshot, timestamp };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => right.timestamp - left.timestamp);

  return snapshots[0]?.snapshot ?? null;
}

export async function waitForWorkflowPhase(homeDir, phase, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 250;
  const child = options.child ?? null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = readLatestWorkflowSnapshot(homeDir);
    if (snapshot?.phase === phase) {
      return snapshot;
    }
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(
        `Installed workflow process exited before reaching phase ${phase} (code=${child.exitCode}, signal=${child.signalCode}).`,
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }

  if (child && (child.exitCode !== null || child.signalCode !== null)) {
    throw new Error(
      `Installed workflow process exited before reaching phase ${phase} (code=${child.exitCode}, signal=${child.signalCode}).`,
    );
  }

  throw new Error(`Timed out waiting for installed workflow phase ${phase}.`);
}

export function assertInstalledLauncherBasics({
  installRoot,
  homeDir,
  expectedVersion,
  missingWorkerPath,
  label,
}) {
  const versionResult = runInstalledCli(installRoot, homeDir, ["--version"]);
  if (
    versionResult.status !== 0 ||
    versionResult.stdout.trim() !== expectedVersion ||
    versionResult.stderr.trim() !== ""
  ) {
    fail(
      `${label} returned an unexpected version:\n${formatResultDiagnostics(versionResult)}`,
    );
  }

  const welcomeResult = runInstalledCli(installRoot, homeDir, ["--no-banner"]);
  if (
    welcomeResult.status !== 0 ||
    !welcomeResult.stdout.includes("privacy-pools status") ||
    !welcomeResult.stdout.includes("privacy-pools init") ||
    !welcomeResult.stdout.includes("This CLI is experimental. Use at your own risk.") ||
    !welcomeResult.stdout.includes("For large transactions, use privacypools.com.") ||
    welcomeResult.stderr.trim() !== "" ||
    welcomeResult.stdout.includes("Running from source?")
  ) {
    fail(
      `${label} bare welcome output failed:\n${formatResultDiagnostics(welcomeResult)}`,
    );
  }

  const helpResult = runInstalledCli(installRoot, homeDir, ["--help"]);
  if (
    helpResult.status !== 0 ||
    !helpResult.stdout.includes("privacy-pools") ||
    helpResult.stderr.trim() !== ""
  ) {
    fail(
      `${label} help failed:\n${formatResultDiagnostics(helpResult)}`,
    );
  }

  const guideResult = runInstalledCli(installRoot, homeDir, ["--agent", "guide"]);
  const guidePayload = parseJson(guideResult.stdout, "guide --agent");
  if (
    guideResult.status !== 0 ||
    guideResult.stderr.trim() !== "" ||
    guidePayload.success !== true ||
    guidePayload.mode !== "help"
  ) {
    fail(
      `${label} guide discovery failed:\n${formatResultDiagnostics(guideResult)}`,
    );
  }

  if (missingWorkerPath) {
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
        `${label} failed native launcher resolution:\n${formatResultDiagnostics(nativeResolutionResult)}`,
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
        `${label} no longer distinguishes native resolution from JS fallback:\n${formatResultDiagnostics(disabledNativeResolutionResult)}`,
      );
    }
  }
}

export function assertInstalledStatusSuccess({
  installRoot,
  homeDir,
  label,
  env = {},
  expectRecoveryPhraseSet = true,
  expectSignerKeyValid = true,
}) {
  const statusResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "status", "--no-check"],
    { env },
  );
  const statusPayload = parseJson(
    statusResult.stdout,
    "status --agent --no-check",
  );

  if (
    statusResult.status !== 0 ||
    statusPayload.success !== true ||
    statusPayload.recoveryPhraseSet !== expectRecoveryPhraseSet ||
    statusPayload.signerKeyValid !== expectSignerKeyValid
  ) {
    fail(
      `${label} failed status parity:\n${formatResultDiagnostics(statusResult)}`,
    );
  }

  return statusPayload;
}

export function assertInstalledInitViaStdin({
  installRoot,
  homeDir,
  label,
  mnemonic,
  privateKey,
  defaultChain = "sepolia",
}) {
  const initResult = runInstalledCli(
    installRoot,
    homeDir,
    [
      "--agent",
      "init",
      "--recovery-phrase-file",
      writeInstallSecretFile(homeDir, "install-test-mnemonic.txt", mnemonic),
      "--private-key-stdin",
      "--default-chain",
      defaultChain,
      "--yes",
    ],
    {
      input: `${privateKey}\n`,
      timeout: 60_000,
    },
  );
  const initPayload = parseJson(
    initResult.stdout,
    "init --agent",
    [mnemonic, privateKey],
  );
  if (
    initResult.status !== 0 ||
    initPayload.success !== true ||
    initPayload.defaultChain !== defaultChain
  ) {
    fail(
      `${label} failed JS-forwarded init via stdin:\n${formatResultDiagnostics(initResult, [mnemonic, privateKey])}`,
    );
  }

  if (
    initResult.stdout.includes(privateKey) ||
    initResult.stderr.includes(privateKey)
  ) {
    fail(`${label} leaked the stdin private key`);
  }

  return initPayload;
}

export async function assertInstalledNativeStatsSuccess({
  installRoot,
  homeDir,
  label,
  missingWorkerPath,
}) {
  const aspFixture = await launchAspFixtureServer(label);
  try {
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
        `${label} failed native read-only success parity:\n${formatResultDiagnostics(statsResult)}`,
      );
    }
  } finally {
    await aspFixture.close();
  }
}

export async function assertInstalledFlowAwaitingFunding({
  installRoot,
  homeDir,
  label,
  exportPath,
  recipient,
  chain = "sepolia",
}) {
  const aspFixture = await launchAspFixtureServer(label);
  const flowStartHandle = spawnInstalledCli(
    installRoot,
    homeDir,
    [
      "--agent",
      "flow",
      "start",
      "100",
      "USDC",
      "--to",
      recipient,
      "--new-wallet",
      "--export-new-wallet",
      exportPath,
      "--chain",
      chain,
    ],
    {
      env: {
        PRIVACY_POOLS_ASP_HOST: aspFixture.url,
      },
    },
  );

  try {
    const awaitingFunding = await waitForWorkflowPhase(homeDir, "awaiting_funding", {
      child: flowStartHandle.child,
    });
    if (awaitingFunding.walletMode !== "new_wallet") {
      fail(
        `${label} created an unexpected workflow wallet mode:\nphase=${awaitingFunding.phase}\nwalletMode=${awaitingFunding.walletMode ?? "<missing>"}`,
      );
    }

    const flowStatusResult = runInstalledCli(
      installRoot,
      homeDir,
      ["--agent", "flow", "status", "latest", "--chain", chain],
      {
        env: {
          PRIVACY_POOLS_ASP_HOST: aspFixture.url,
        },
      },
    );
    const flowStatusPayload = parseJson(
      flowStatusResult.stdout,
      "flow status latest --agent",
      [recipient],
    );
    if (
      flowStatusResult.status !== 0 ||
      flowStatusPayload.success !== true ||
      flowStatusPayload.phase !== "awaiting_funding" ||
      flowStatusPayload.walletMode !== "new_wallet"
    ) {
      fail(
        `${label} failed JS-forwarded flow status parity:\n${formatResultDiagnostics(flowStatusResult, [recipient])}`,
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `${label} failed JS-forwarded flow setup parity:\n${redactSensitiveText(reason, [recipient])}\nstdout=${previewOutput(flowStartHandle.getStdout(), [recipient])}\nstderr=${previewOutput(flowStartHandle.getStderr(), [recipient])}`,
    );
  } finally {
    await stopInstalledCliChild(flowStartHandle);
    await aspFixture.close();
  }
}

export function assertInstalledNativeStatsError({
  installRoot,
  homeDir,
  label,
}) {
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
      `${label} failed native read-only error parity:\n${formatResultDiagnostics(statsResult)}`,
    );
  }
}
