import { basename } from "node:path";
import { existsSync } from "node:fs";
import { CLIError } from "../utils/errors.js";
import {
  createNativeJsBridgeDescriptor,
  CURRENT_RUNTIME_REQUEST_ENV,
  encodeCurrentWorkerRequest,
  encodeNativeJsBridgeDescriptor,
  NATIVE_JS_BRIDGE_ENV,
  resolveCurrentWorkerPath,
} from "./current.js";
import {
  ENV_CLI_JS_WORKER,
  ENV_PRIVATE_KEY,
} from "./native-resolution.js";

const SECRET_BEARING_FLAGS = new Set(["--recovery-phrase", "--private-key"]);

export interface LaunchTarget {
  kind: "js-worker" | "native-binary";
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface JsWorkerLaunchConfig {
  path: string;
  args: string[];
}

export function defaultJsWorkerPath(): string {
  return resolveCurrentWorkerPath();
}

function defaultJsRuntimeCommand(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

function looksLikeNodeExecutable(command: string): boolean {
  const name = basename(command).toLowerCase();
  return name === "node" || name === "node.exe";
}

export function resolveJsRuntimeCommand(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const npmNodeExecPath = env.npm_node_execpath?.trim();
  if (npmNodeExecPath && looksLikeNodeExecutable(npmNodeExecPath)) {
    return npmNodeExecPath;
  }

  const execPath = process.execPath?.trim();
  if (execPath && !process.versions.bun && looksLikeNodeExecutable(execPath)) {
    return execPath;
  }

  return defaultJsRuntimeCommand();
}

function defaultJsWorkerArgs(workerPath: string): string[] {
  return [workerPath];
}

export function resolveConfiguredJsWorkerPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[ENV_CLI_JS_WORKER]?.trim() || defaultJsWorkerPath();
}

function resolveSourceWorkerFallback(workerPath: string): string | null {
  if (!workerPath.endsWith(".js")) {
    return null;
  }

  const tsWorkerPath = `${workerPath.slice(0, -3)}.ts`;
  return existsSync(tsWorkerPath) ? tsWorkerPath : null;
}

function resolveJsWorkerLaunchConfig(
  env: NodeJS.ProcessEnv = process.env,
): JsWorkerLaunchConfig {
  const workerPath = resolveConfiguredJsWorkerPath(env);
  if (existsSync(workerPath)) {
    return {
      path: workerPath,
      args: defaultJsWorkerArgs(workerPath),
    };
  }

  if (!env[ENV_CLI_JS_WORKER]?.trim()) {
    const sourceWorkerPath = resolveSourceWorkerFallback(workerPath);
    if (sourceWorkerPath) {
      return {
        path: sourceWorkerPath,
        args: [
          "--import",
          "./src/runtime/color-env-bootstrap.ts",
          "--import",
          "tsx",
          sourceWorkerPath,
        ],
      };
    }
  }

  return {
    path: workerPath,
    args: defaultJsWorkerArgs(workerPath),
  };
}

export function invocationContainsInlineSecrets(argv: readonly string[]): boolean {
  return argv.some((token) => {
    if (SECRET_BEARING_FLAGS.has(token)) return true;
    return (
      token.startsWith("--recovery-phrase=") ||
      token.startsWith("--private-key=")
    );
  });
}

export function createJsWorkerTarget(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): LaunchTarget {
  const workerLaunch = resolveJsWorkerLaunchConfig(env);
  return {
    kind: "js-worker",
    command: resolveJsRuntimeCommand(env),
    args: workerLaunch.args,
    env: {
      ...env,
      [CURRENT_RUNTIME_REQUEST_ENV]: encodeCurrentWorkerRequest(argv),
    },
  };
}

export function createNativeForwardingEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const workerLaunch = resolveJsWorkerLaunchConfig(env);
  const nextEnv = {
    ...env,
  };
  delete nextEnv[ENV_PRIVATE_KEY];
  return {
    ...nextEnv,
    [ENV_CLI_JS_WORKER]: workerLaunch.path,
    [NATIVE_JS_BRIDGE_ENV]: encodeNativeJsBridgeDescriptor(
      createNativeJsBridgeDescriptor(
        resolveJsRuntimeCommand(env),
        workerLaunch.args,
      ),
    ),
  };
}

export function validateJsWorkerPath(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const workerLaunch = resolveJsWorkerLaunchConfig(env);
  if (existsSync(workerLaunch.path)) {
    return;
  }

  const overrideHint = env[ENV_CLI_JS_WORKER]?.trim()
    ? `Unset ${ENV_CLI_JS_WORKER} or point it at a real JS worker file, then retry.`
    : "Reinstall the CLI or restore the packaged JS worker, then retry.";

  throw new CLIError(
    "The JS runtime worker is unavailable.",
    "INPUT",
    overrideHint,
  );
}
