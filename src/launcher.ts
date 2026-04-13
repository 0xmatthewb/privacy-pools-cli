import { spawn } from "node:child_process";
import type { CliPackageInfo } from "./package-info.js";
import { createCurrentWorkerRequest } from "./runtime/current.js";
import {
  elapsedRuntimeMs,
  emitRuntimeDiagnostic,
  runtimeStopwatch,
} from "./runtime/diagnostics.js";
import {
  resolveInvocationPlan,
  resolveCommandRoute,
  invocationRequiresJsWorker,
  resolveLaunchTarget,
} from "./runtime/invocation-plan.js";
import {
  createJsWorkerTarget,
  createNativeForwardingEnv,
  defaultJsWorkerPath,
  type LaunchTarget,
  invocationContainsInlineSecrets,
  resolveConfiguredJsWorkerPath,
  resolveJsRuntimeCommand,
  validateJsWorkerPath,
} from "./runtime/launch-target.js";
import {
  clearInstalledNativeVerificationCache,
  createInstalledNativeVerificationCacheEntry,
  ENV_CLI_JS_WORKER,
  hasCompatibleInstalledNativeMetadata,
  hasExplicitBinaryOverride,
  hasExplicitJsWorkerOverride,
  hasInstalledNativeVerificationCacheHit,
  installedNativeVerificationCachePath,
  isLauncherFlagEnabled,
  nativePackageName,
  nativeTriplet,
  readInstalledNativeVerificationCache,
  resolveInstalledNativeBinary,
} from "./runtime/native-resolution.js";
import { resolveConfigHome } from "./runtime/config-paths.js";
import {
  exitSuccessfulFastPath,
  runLocalFastPathPlan,
  writeVersionOutput,
} from "./runtime/local-fast-path.js";
import { hasValidNativeChecksum } from "./native-package-metadata.js";
import { CLIError, printError } from "./utils/errors.js";
import type { ParsedRootArgv } from "./utils/root-argv.js";
import { parseRootArgv } from "./utils/root-argv.js";

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

type CliPackageInfoSource = CliPackageInfo | (() => CliPackageInfo);
type SpawnImplementation = typeof spawn;

let spawnImplementation: SpawnImplementation = spawn;

function resolveCliPackageInfo(
  pkg: CliPackageInfoSource,
): CliPackageInfo {
  return typeof pkg === "function" ? pkg() : pkg;
}

function applyLauncherEnvironment(argv: string[]): void {
  if (argv.includes("--no-color") || process.env.TERM === "dumb") {
    process.env.NO_COLOR = "1";
  }
  // CLICOLOR_FORCE=1 forces color even in piped/non-TTY contexts (unless NO_COLOR wins).
  if (process.env.CLICOLOR_FORCE === "1" && !process.env.NO_COLOR) {
    // chalk respects FORCE_COLOR env var internally
    process.env.FORCE_COLOR = "3";
  }
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
  const startedAt = runtimeStopwatch();
  try {
    let plan = resolveInvocationPlan(pkg, argv, process.env, {
      parsed,
    });
    emitRuntimeDiagnostic("plan", {
      kind: plan.kind,
      route: plan.route ?? "<none>",
      structured: parsed.isStructuredOutputMode,
    });

    if (plan.kind === "local-static") {
      const handled = await runLocalFastPathPlan(plan, pkg, argv);
      if (handled) {
        emitRuntimeDiagnostic("complete", {
          kind: plan.kind,
          route: plan.route ?? "<none>",
          elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
        });
        return;
      }

      plan = resolveInvocationPlan(pkg, argv, process.env, {
        parsed,
        skipLocalFastPath: true,
      });
      emitRuntimeDiagnostic("replan", {
        kind: plan.kind,
        route: plan.route ?? "<none>",
      });
    }

    if (plan.kind === "local-static") {
      throw new CLIError(
        "Local static invocation planning did not resolve to an executable target.",
        "UNKNOWN",
        "Retry the command or rerun with PRIVACY_POOLS_DEBUG_RUNTIME=1 for diagnostics.",
      );
    }

    const target = plan.target;

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

    if (plan.kind === "spawn-js-worker") {
      validateJsWorkerPath(target.env);
    }

    if (plan.kind === "spawn-native") {
      emitRuntimeDiagnostic("spawn", {
        kind: plan.kind,
        route: plan.route ?? "<none>",
        command: target.command,
      });
      await spawnLaunchTarget(target);
      emitRuntimeDiagnostic("complete", {
        kind: plan.kind,
        route: plan.route ?? "<none>",
        elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      });
      return;
    }

    if (plan.kind === "inline-js") {
      emitRuntimeDiagnostic("inline", {
        kind: plan.kind,
        route: plan.route ?? "<none>",
      });
      await runJsWorkerInline(pkg, argv);
      emitRuntimeDiagnostic("complete", {
        kind: plan.kind,
        route: plan.route ?? "<none>",
        elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
      });
      return;
    }

    emitRuntimeDiagnostic("spawn", {
      kind: plan.kind,
      route: plan.route ?? "<none>",
      command: target.command,
    });
    await spawnLaunchTarget(target);
    emitRuntimeDiagnostic("complete", {
      kind: plan.kind,
      route: plan.route ?? "<none>",
      elapsedMs: elapsedRuntimeMs(startedAt).toFixed(2),
    });
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
  resolveJsRuntimeCommand,
  hasExplicitBinaryOverride,
  hasExplicitJsWorkerOverride,
  invocationRequiresJsWorker,
  hasCompatibleInstalledNativeMetadata,
  isFlagEnabled: isLauncherFlagEnabled,
  invocationContainsInlineSecrets,
  hasValidInstalledNativeChecksum: hasValidNativeChecksum,
  nativePackageName,
  nativeTriplet,
  configHome: resolveConfigHome,
  resolveCliPackageInfo,
  resolveConfiguredJsWorkerPath,
  resolveCommandRoute,
  installedNativeVerificationCachePath,
  clearInstalledNativeVerificationCache,
  readInstalledNativeVerificationCache,
  createInstalledNativeVerificationCacheEntry,
  hasInstalledNativeVerificationCacheHit,
  resolveInstalledNativeBinary,
  resolveLaunchTarget,
  resolveInvocationPlan,
  resetSpawnImplementationForTests: (): void => {
    spawnImplementation = spawn;
  },
  tryRunLocalFastPath: async (
    pkg: CliPackageInfoSource,
    argv: string[],
    parsed: ParsedRootArgv,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<boolean> => {
    const plan = resolveInvocationPlan(pkg, argv, env, { parsed });
    return runLocalFastPathPlan(plan, pkg, argv);
  },
  setSpawnImplementationForTests: (nextSpawn: SpawnImplementation): void => {
    spawnImplementation = nextSpawn;
  },
  validateJsWorkerPath,
  exitSuccessfulFastPath,
  writeVersionOutput,
};
