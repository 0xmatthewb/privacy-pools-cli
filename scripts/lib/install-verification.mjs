import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = dirname(dirname(libDir));
export const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
export const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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

export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function currentNativePackageName(
  platform = process.platform,
  arch = process.arch,
) {
  return resolveNativePackageName(platform, arch);
}

export function packageInstallPath(installRoot, packageName) {
  return join(installRoot, "node_modules", ...packageName.split("/"));
}

export function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`${label} did not emit valid JSON:\n${reason}\n${stdout}`);
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

function installCliEnv(homeDir, env = {}) {
  return {
    ...process.env,
    PP_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    PRIVACY_POOLS_HOME: homeDir,
    ...env,
  };
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
    fail(
      `Failed to execute privacy-pools ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  return result;
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
  if (versionResult.status !== 0 || versionResult.stdout.trim() !== expectedVersion) {
    fail(
      `${label} returned an unexpected version:\nstatus=${versionResult.status}\nstdout=${versionResult.stdout}\nstderr=${versionResult.stderr}`,
    );
  }

  const helpResult = runInstalledCli(installRoot, homeDir, ["--help"]);
  if (helpResult.status !== 0 || !helpResult.stdout.includes("privacy-pools")) {
    fail(
      `${label} help failed:\nstatus=${helpResult.status}\nstdout=${helpResult.stdout}\nstderr=${helpResult.stderr}`,
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
      `${label} failed native launcher resolution:\nstatus=${nativeResolutionResult.status}\nstdout=${nativeResolutionResult.stdout}\nstderr=${nativeResolutionResult.stderr}`,
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
      `${label} no longer distinguishes native resolution from JS fallback:\nstdout=${disabledNativeResolutionResult.stdout}\nstderr=${disabledNativeResolutionResult.stderr}`,
    );
  }
}
