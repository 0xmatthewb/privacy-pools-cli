import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { CliPackageInfo } from "./package-info.js";
import { CLI_PROTOCOL_PROFILE } from "./config/protocol-profile.js";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "./runtime/runtime-contract.js";
import {
  createNativeJsBridgeDescriptor,
  CURRENT_RUNTIME_REQUEST_ENV,
  encodeCurrentWorkerRequest,
  encodeNativeJsBridgeDescriptor,
  NATIVE_JS_BRIDGE_ENV,
  resolveCurrentWorkerPath,
} from "./runtime/current.js";
import { parseRootArgv } from "./utils/root-argv.js";
import { printJsonSuccess } from "./utils/json.js";
import { GENERATED_STATIC_LOCAL_COMMANDS } from "./utils/command-discovery-static.js";

const ENV_CLI_BINARY = "PRIVACY_POOLS_CLI_BINARY";
const ENV_CLI_DISABLE_NATIVE = "PRIVACY_POOLS_CLI_DISABLE_NATIVE";
const ENV_CLI_ENABLE_NATIVE = "PRIVACY_POOLS_CLI_ENABLE_NATIVE";
const ENV_CLI_JS_WORKER = "PRIVACY_POOLS_CLI_JS_WORKER";

const STATIC_DISCOVERY_COMMANDS = new Set<string>(
  [...GENERATED_STATIC_LOCAL_COMMANDS].filter((command) => command !== "completion"),
);

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

interface NativePackageJson {
  version?: string;
  bin?: string | Record<string, string>;
  privacyPoolsCliNative?: {
    binaryPath?: string;
    sha256?: string;
    bridgeVersion?: string;
    protocolVersion?: string;
    protocolProfile?: string;
    runtimeVersion?: string;
    triplet?: string;
  };
}

export interface LaunchTarget {
  kind: "js-worker" | "native-binary";
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function isFlagEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

function usesLegacyNativePreviewOptIn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isFlagEnabled(env[ENV_CLI_ENABLE_NATIVE]);
}

function defaultJsWorkerPath(): string {
  return resolveCurrentWorkerPath();
}

function defaultJsWorkerArgs(workerPath: string): string[] {
  return process.versions.bun
    ? ["--no-env-file", workerPath]
    : [workerPath];
}

function nativeTriplet(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64-gnu";
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  if (platform === "win32" && arch === "arm64") return "win32-arm64-msvc";
  return null;
}

function nativePackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const triplet = nativeTriplet(platform, arch);
  return triplet ? `@0xbow/privacy-pools-cli-native-${triplet}` : null;
}

function resolvePackageBinaryPath(
  packageJsonPath: string,
  packageJson: NativePackageJson,
): string | null {
  const metadataBinaryPath =
    packageJson.privacyPoolsCliNative?.binaryPath?.trim() || null;
  if (metadataBinaryPath) {
    return resolve(dirname(packageJsonPath), metadataBinaryPath);
  }

  const legacyBinEntry =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.["privacy-pools"];

  if (!legacyBinEntry) return null;
  return resolve(dirname(packageJsonPath), legacyBinEntry);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hasValidInstalledNativeChecksum(
  packageJson: NativePackageJson,
  binaryPath: string,
): boolean {
  const expected = packageJson.privacyPoolsCliNative?.sha256?.trim();
  if (!expected) return false;
  try {
    return sha256File(binaryPath) === expected;
  } catch {
    return false;
  }
}

function hasCompatibleInstalledNativeMetadata(
  packageJson: NativePackageJson,
): boolean {
  const metadata = packageJson.privacyPoolsCliNative;
  const actualBridgeVersion = resolveInstalledNativeBridgeVersion(metadata);
  if (actualBridgeVersion !== CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion) {
    return false;
  }

  // Packages published before runtimeVersion existed can still be accepted
  // through the legacy protocolVersion bridge gate on exact CLI version.
  if (
    metadata?.bridgeVersion &&
    metadata.runtimeVersion?.trim() !== CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion
  ) {
    return false;
  }

  const protocolProfile = metadata?.protocolProfile?.trim();
  if (protocolProfile && protocolProfile !== CLI_PROTOCOL_PROFILE.profile) {
    return false;
  }

  return true;
}

function resolveInstalledNativeBridgeVersion(
  metadata: NativePackageJson["privacyPoolsCliNative"],
): string | null {
  // Older preview artifacts used protocolVersion for bridge compatibility.
  // Keep accepting that alias for rollback compatibility, but publish only
  // bridgeVersion in new native packages.
  return metadata?.bridgeVersion?.trim() || metadata?.protocolVersion?.trim() || null;
}

export function resolveInstalledNativeBinary(
  pkg: CliPackageInfo,
  options: {
    platform?: NodeJS.Platform;
    arch?: string;
    requireResolve?: (id: string) => string;
  } = {},
): string | null {
  const packageName = nativePackageName(
    options.platform,
    options.arch,
  );
  if (!packageName) return null;

  const requireResolve =
    options.requireResolve ?? createRequire(import.meta.url).resolve;

  try {
    const packageJsonPath = requireResolve(`${packageName}/package.json`);
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    ) as NativePackageJson;

    if (packageJson.version !== pkg.version) {
      return null;
    }

    if (!hasCompatibleInstalledNativeMetadata(packageJson)) {
      return null;
    }

    const binaryPath = resolvePackageBinaryPath(packageJsonPath, packageJson);
    if (!binaryPath) return null;
    if (!hasValidInstalledNativeChecksum(packageJson, binaryPath)) {
      return null;
    }

    return binaryPath;
  } catch {
    return null;
  }
}

function createJsWorkerTarget(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): LaunchTarget {
  const workerPath = env[ENV_CLI_JS_WORKER]?.trim() || defaultJsWorkerPath();
  const childArgs = defaultJsWorkerArgs(workerPath);
  return {
    kind: "js-worker",
    command: process.execPath,
    args: childArgs,
    env: {
      ...env,
      [CURRENT_RUNTIME_REQUEST_ENV]: encodeCurrentWorkerRequest(argv),
    },
  };
}

function createNativeForwardingEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const workerPath = env[ENV_CLI_JS_WORKER]?.trim() || defaultJsWorkerPath();
  const workerArgs = defaultJsWorkerArgs(workerPath);
  return {
    ...env,
    [ENV_CLI_JS_WORKER]: workerPath,
    [NATIVE_JS_BRIDGE_ENV]: encodeNativeJsBridgeDescriptor(
      createNativeJsBridgeDescriptor(process.execPath, workerArgs),
    ),
  };
}

export function resolveLaunchTarget(
  pkg: CliPackageInfo,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  options: {
    resolveInstalledNativeBinary?: typeof resolveInstalledNativeBinary;
  } = {},
): LaunchTarget {
  if (isFlagEnabled(env[ENV_CLI_DISABLE_NATIVE])) {
    return createJsWorkerTarget(argv, env);
  }

  const explicitBinary = env[ENV_CLI_BINARY]?.trim();
  if (explicitBinary) {
    return {
      kind: "native-binary",
      command: explicitBinary,
      args: [...argv],
      env: createNativeForwardingEnv(env),
    };
  }

  const resolveInstalledNativeBinaryFn =
    options.resolveInstalledNativeBinary ?? resolveInstalledNativeBinary;
  // Same-version packaged native binaries are preferred by default once they
  // pass the checksum/version gates. Keep reading the legacy preview opt-in so
  // older automation can continue exporting it as a benign no-op.
  void usesLegacyNativePreviewOptIn(env);
  const nativeBinary = resolveInstalledNativeBinaryFn(pkg);
  if (nativeBinary) {
    return {
      kind: "native-binary",
      command: nativeBinary,
      args: [...argv],
      env: createNativeForwardingEnv(env),
    };
  }

  return createJsWorkerTarget(argv, env);
}

async function writeVersionOutput(
  pkg: CliPackageInfo,
  isStructuredOutputMode: boolean,
): Promise<void> {
  if (isStructuredOutputMode) {
    printJsonSuccess({
      mode: "version",
      version: pkg.version,
    });
    return;
  }

  process.stdout.write(`${pkg.version}\n`);
}

function applyLauncherEnvironment(argv: string[]): void {
  if (argv.includes("--no-color")) {
    process.env.NO_COLOR = "1";
  }
}

async function spawnLaunchTarget(target: LaunchTarget): Promise<void> {
  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    const child = spawn(target.command, target.args, {
      env: target.env,
      stdio: "inherit",
    });

    const forwardSignal = (forwardedSignal: NodeJS.Signals) => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(forwardedSignal);
      }
    };

    const onSigInt = () => forwardSignal("SIGINT");
    const onSigTerm = () => forwardSignal("SIGTERM");

    const cleanup = () => {
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
    };

    process.on("SIGINT", onSigInt);
    process.on("SIGTERM", onSigTerm);

    child.once("error", (error) => {
      cleanup();
      reject(error);
    });

    child.once("exit", (childCode, childSignal) => {
      cleanup();
      resolve({ code: childCode, signal: childSignal });
    });
  });

  if (signal) {
    process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
    return;
  }

  if ((code ?? 1) !== 0) {
    process.exit(code ?? 1);
  }
}

export async function runLauncher(
  pkg: CliPackageInfo,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  applyLauncherEnvironment(argv);

  const parsed = parseRootArgv(argv);
  const target = resolveLaunchTarget(pkg, argv);

  if (target.kind === "native-binary") {
    await spawnLaunchTarget(target);
    return;
  }

  if (parsed.isVersionLike && parsed.firstCommandToken === undefined) {
    await writeVersionOutput(pkg, parsed.isStructuredOutputMode);
    process.exit(0);
  }

  if (parsed.isRootHelpInvocation) {
    const { runStaticRootHelp } = await import("./static-discovery.js");
    await runStaticRootHelp(parsed.isStructuredOutputMode);
    process.exit(0);
  }

  if (
    !parsed.isHelpLike &&
    !parsed.isVersionLike &&
    parsed.firstCommandToken === "completion"
  ) {
    const { runStaticCompletionQuery } = await import("./static-discovery.js");
    if (await runStaticCompletionQuery(argv)) {
      process.exit(0);
    }
  }

  if (
    !parsed.isHelpLike &&
    !parsed.isVersionLike &&
    STATIC_DISCOVERY_COMMANDS.has(parsed.firstCommandToken ?? "")
  ) {
    const { runStaticDiscoveryCommand } = await import("./static-discovery.js");
    if (await runStaticDiscoveryCommand(argv)) {
      process.exit(0);
    }
  }

  await spawnLaunchTarget(target);
}

export const launcherTestInternals = {
  applyLauncherEnvironment,
  createNativeForwardingEnv,
  createJsWorkerTarget,
  defaultJsWorkerPath,
  hasCompatibleInstalledNativeMetadata,
  isFlagEnabled,
  hasValidInstalledNativeChecksum,
  nativePackageName,
  nativeTriplet,
  resolveInstalledNativeBinary,
  resolveLaunchTarget,
  writeVersionOutput,
};
