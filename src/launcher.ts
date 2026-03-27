import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { CliPackageInfo } from "./package-info.js";
import { CLI_PROTOCOL_PROFILE } from "./config/protocol-profile.js";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "./runtime/runtime-contract.js";
import {
  createCurrentWorkerRequest,
  createNativeJsBridgeDescriptor,
  CURRENT_RUNTIME_REQUEST_ENV,
  encodeCurrentWorkerRequest,
  encodeNativeJsBridgeDescriptor,
  NATIVE_JS_BRIDGE_ENV,
  resolveCurrentWorkerPath,
} from "./runtime/current.js";
import {
  nativePackageName as resolveNativePackageName,
  nativeTriplet as resolveNativeTriplet,
} from "./native-distribution.js";
import {
  hasCompatibleNativeMetadata,
  hasValidNativeChecksum,
  resolveNativeBinaryPath,
} from "./native-package-metadata.js";
import type { ParsedRootArgv } from "./utils/root-argv.js";
import { parseRootArgv } from "./utils/root-argv.js";
import { invalidOutputFormatMessage, isSupportedOutputFormat } from "./utils/mode.js";
import { CLIError, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
import {
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_ROUTES,
  GENERATED_STATIC_LOCAL_COMMANDS,
  GENERATED_TOKENIZED_COMMAND_ROUTES,
} from "./utils/command-routing-static.js";

const ENV_CLI_BINARY = "PRIVACY_POOLS_CLI_BINARY";
const ENV_CLI_DISABLE_NATIVE = "PRIVACY_POOLS_CLI_DISABLE_NATIVE";
const ENV_CLI_DISABLE_LOCAL_FAST_PATH = "PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH";
const ENV_CLI_ENABLE_NATIVE = "PRIVACY_POOLS_CLI_ENABLE_NATIVE";
const ENV_CLI_JS_WORKER = "PRIVACY_POOLS_CLI_JS_WORKER";
const ENV_PRIVATE_KEY = "PRIVACY_POOLS_PRIVATE_KEY";
const SECRET_BEARING_FLAGS = new Set(["--mnemonic", "--private-key"]);

const STATIC_DISCOVERY_COMMANDS = new Set<string>(
  [...GENERATED_STATIC_LOCAL_COMMANDS].filter((command) => command !== "completion"),
);
const TOKENIZED_COMMAND_ROUTES = GENERATED_TOKENIZED_COMMAND_ROUTES;

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

type CliPackageInfoSource = CliPackageInfo | (() => CliPackageInfo);
type SpawnImplementation = typeof spawn;

let spawnImplementation: SpawnImplementation = spawn;

function isFlagEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

function resolveCliPackageInfo(
  pkg: CliPackageInfoSource,
): CliPackageInfo {
  return typeof pkg === "function" ? pkg() : pkg;
}

function defaultJsWorkerPath(): string {
  return resolveCurrentWorkerPath();
}

function defaultJsWorkerArgs(workerPath: string): string[] {
  return process.versions.bun
    ? ["--no-env-file", workerPath]
    : [workerPath];
}

function resolveConfiguredJsWorkerPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[ENV_CLI_JS_WORKER]?.trim() || defaultJsWorkerPath();
}

function hasExplicitBinaryOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[ENV_CLI_BINARY]?.trim());
}

function hasExplicitJsWorkerOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[ENV_CLI_JS_WORKER]?.trim());
}

function invocationContainsInlineSecrets(argv: readonly string[]): boolean {
  return argv.some((token) => {
    if (SECRET_BEARING_FLAGS.has(token)) return true;
    return (
      token.startsWith("--mnemonic=") ||
      token.startsWith("--private-key=")
    );
  });
}

function nativeTriplet(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  libc: string | null | undefined = platform === "linux" ? undefined : null,
): string | null {
  return resolveNativeTriplet(platform, arch, libc);
}

function nativePackageName(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  libc: string | null | undefined = platform === "linux" ? undefined : null,
): string | null {
  return resolveNativePackageName(platform, arch, libc);
}

function hasCompatibleInstalledNativeMetadata(
  packageJson: NativePackageJson,
): boolean {
  return hasCompatibleNativeMetadata(packageJson, {
    nativeBridgeVersion: CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
    runtimeVersion: CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
    protocolProfile: CLI_PROTOCOL_PROFILE.profile,
  });
}

export function resolveInstalledNativeBinary(
  pkg: CliPackageInfo,
  options: {
    platform?: NodeJS.Platform;
    arch?: NodeJS.Architecture;
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

    const binaryPath = resolveNativeBinaryPath(packageJsonPath, packageJson, {
      allowLegacyBin: true,
    });
    if (!binaryPath) return null;
    if (!hasValidNativeChecksum(packageJson, binaryPath)) {
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
  const workerPath = resolveConfiguredJsWorkerPath(env);
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
  const workerPath = resolveConfiguredJsWorkerPath(env);
  const workerArgs = defaultJsWorkerArgs(workerPath);
  const nextEnv = {
    ...env,
  };
  delete nextEnv[ENV_PRIVATE_KEY];
  return {
    ...nextEnv,
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
    parsed?: ParsedRootArgv;
  } = {},
): LaunchTarget {
  if (isFlagEnabled(env[ENV_CLI_DISABLE_NATIVE])) {
    return createJsWorkerTarget(argv, env);
  }

  const parsed = options.parsed ?? parseRootArgv(argv);
  if (invocationRequiresJsWorker(parsed)) {
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
  void isFlagEnabled(env[ENV_CLI_ENABLE_NATIVE]);
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

function resolveCommandRoute(tokens: string[]): string | null {
  const candidateTokens = tokens[0] === "help" ? tokens.slice(1) : tokens;
  if (candidateTokens.length === 0) return null;

  const normalizedTokens = [...candidateTokens];
  const aliasedFirstToken = GENERATED_COMMAND_ALIAS_MAP[normalizedTokens[0] ?? ""];
  if (aliasedFirstToken) {
    normalizedTokens.splice(0, 1, ...aliasedFirstToken.split(" "));
  }

  for (const { route, tokens: routeTokens } of TOKENIZED_COMMAND_ROUTES) {
    if (routeTokens.length > normalizedTokens.length) continue;
    if (routeTokens.every((token, index) => normalizedTokens[index] === token)) {
      return route;
    }
  }

  return null;
}

function isHybridInvocationNative(
  route: string,
  parsed: ParsedRootArgv,
  nativeModes: readonly string[],
): boolean {
  if (parsed.isHelpLike) {
    return nativeModes.includes("help");
  }

  if (route === "pools") {
    const isDetailView = parsed.nonOptionTokens.length > 1;
    if (isDetailView) return false;
    if (parsed.isStructuredOutputMode) {
      return nativeModes.includes("structured-list");
    }
    if (parsed.isCsvMode) {
      return nativeModes.includes("csv-list");
    }
    return nativeModes.includes("default-list");
  }

  if (parsed.isStructuredOutputMode) {
    return nativeModes.some((mode) => mode.startsWith("structured"));
  }
  if (parsed.isCsvMode) {
    return nativeModes.includes("csv");
  }
  return nativeModes.includes("default");
}

function invocationRequiresJsWorker(parsed: ParsedRootArgv): boolean {
  if (parsed.isVersionLike && parsed.firstCommandToken === undefined) {
    return false;
  }

  if (parsed.isRootHelpInvocation) {
    return false;
  }

  const route = resolveCommandRoute(parsed.nonOptionTokens);
  if (!route) {
    return parsed.firstCommandToken !== undefined || parsed.nonOptionTokens.length === 0;
  }

  const commandRoute = GENERATED_COMMAND_ROUTES[
    route as keyof typeof GENERATED_COMMAND_ROUTES
  ];

  if (commandRoute.owner === "native-shell") {
    return false;
  }

  if (commandRoute.owner === "js-runtime") {
    return !parsed.isHelpLike || !commandRoute.nativeModes.includes("help");
  }

  return !isHybridInvocationNative(route, parsed, commandRoute.nativeModes);
}

function validateJsWorkerPath(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const workerPath = resolveConfiguredJsWorkerPath(env);
  const hasSourceTwin =
    extname(workerPath) === ".js" &&
    existsSync(workerPath.slice(0, -3) + ".ts");
  if (existsSync(workerPath) || hasSourceTwin) {
    return;
  }

  const overrideHint = env[ENV_CLI_JS_WORKER]?.trim()
    ? `Unset ${ENV_CLI_JS_WORKER} or point it at a valid worker file, then retry.`
    : "Reinstall the CLI or restore the packaged JS worker, then retry.";

  throw new CLIError(
    "The JS runtime worker is unavailable.",
    "INPUT",
    overrideHint,
  );
}

async function tryRunLocalFastPath(
  pkg: CliPackageInfoSource,
  argv: string[],
  parsed: ParsedRootArgv,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (
    hasExplicitBinaryOverride(env) ||
    isFlagEnabled(env[ENV_CLI_DISABLE_LOCAL_FAST_PATH])
  ) {
    return false;
  }

  if (
    parsed.formatFlagValue &&
    !isSupportedOutputFormat(parsed.formatFlagValue)
  ) {
    throw new CLIError(
      invalidOutputFormatMessage(parsed.formatFlagValue),
      "INPUT",
      "Use --help to see usage and examples.",
    );
  }

  if (parsed.isVersionLike && parsed.firstCommandToken === undefined) {
    await writeVersionOutput(resolveCliPackageInfo(pkg), parsed.isStructuredOutputMode);
    process.exit(0);
    return true;
  }

  if (parsed.isRootHelpInvocation) {
    const { runStaticRootHelp } = await import("./static-discovery.js");
    await runStaticRootHelp(parsed.isStructuredOutputMode);
    process.exit(0);
    return true;
  }

  if (
    !parsed.isHelpLike &&
    !parsed.isVersionLike &&
    parsed.firstCommandToken === "completion"
  ) {
    const { runStaticCompletionQuery } = await import("./static-discovery.js");
    if (await runStaticCompletionQuery(argv)) {
      process.exit(0);
      return true;
    }
  }

  if (
    !parsed.isHelpLike &&
    !parsed.isVersionLike &&
    STATIC_DISCOVERY_COMMANDS.has(parsed.firstCommandToken ?? "")
  ) {
    const { runStaticDiscoveryCommand } = await import("./static-discovery.js");
    if (await runStaticDiscoveryCommand(argv, parsed)) {
      process.exit(0);
      return true;
    }
  }

  return false;
}

async function runJsWorkerInline(
  pkg: CliPackageInfoSource,
  argv: string[],
): Promise<void> {
  const { runWorkerRequest } = await import("./runtime/v1/worker.js");
  await runWorkerRequest(
    createCurrentWorkerRequest(argv),
    resolveCliPackageInfo(pkg),
    { installConsoleGuard: true },
  );
}

async function spawnLaunchTarget(target: LaunchTarget): Promise<void> {
  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    const child = spawnImplementation(target.command, target.args, {
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
  pkg: CliPackageInfoSource,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  applyLauncherEnvironment(argv);

  const parsed = parseRootArgv(argv);
  try {
    if (await tryRunLocalFastPath(pkg, argv, parsed)) {
      return;
    }

    const resolvedPackageInfo = resolveCliPackageInfo(pkg);
    const target = resolveLaunchTarget(resolvedPackageInfo, argv, process.env, {
      parsed,
    });

    if (
      hasExplicitJsWorkerOverride(target.env) &&
      invocationContainsInlineSecrets(argv)
    ) {
      throw new CLIError(
        "The JS worker override is unavailable for secret-bearing invocations.",
        "INPUT",
        `Unset ${ENV_CLI_JS_WORKER} or use file/stdin secret flags before retrying.`,
      );
    }

    if (target.kind === "js-worker" && hasExplicitJsWorkerOverride(target.env)) {
      validateJsWorkerPath(target.env);
    } else if (
      target.kind === "native-binary" &&
      invocationRequiresJsWorker(parsed)
    ) {
      validateJsWorkerPath(target.env);
    }

    if (target.kind === "native-binary") {
      await spawnLaunchTarget(target);
      return;
    }

    if (!hasExplicitJsWorkerOverride(target.env)) {
      await runJsWorkerInline(resolvedPackageInfo, argv);
      return;
    }

    await spawnLaunchTarget(target);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "CommandExit"
    ) {
      throw error;
    }
    printError(error, parsed.isStructuredOutputMode);
  }
}

export const launcherTestInternals = {
  applyLauncherEnvironment,
  createNativeForwardingEnv,
  createJsWorkerTarget,
  defaultJsWorkerPath,
  hasExplicitBinaryOverride,
  hasExplicitJsWorkerOverride,
  invocationRequiresJsWorker,
  hasCompatibleInstalledNativeMetadata,
  isFlagEnabled,
  invocationContainsInlineSecrets,
  hasValidInstalledNativeChecksum: hasValidNativeChecksum,
  nativePackageName,
  nativeTriplet,
  resolveCliPackageInfo,
  resolveConfiguredJsWorkerPath,
  resolveCommandRoute,
  resolveInstalledNativeBinary,
  resolveLaunchTarget,
  resetSpawnImplementationForTests: (): void => {
    spawnImplementation = spawn;
  },
  tryRunLocalFastPath,
  setSpawnImplementationForTests: (nextSpawn: SpawnImplementation): void => {
    spawnImplementation = nextSpawn;
  },
  validateJsWorkerPath,
  writeVersionOutput,
};
