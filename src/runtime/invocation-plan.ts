import type { CliPackageInfo } from "../package-info.js";
import type { ParsedRootArgv } from "../utils/root-argv.js";
import { hasLongFlag, parseRootArgv } from "../utils/root-argv.js";
import {
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_ROUTES,
  GENERATED_STATIC_LOCAL_COMMANDS,
  GENERATED_TOKENIZED_COMMAND_ROUTES,
} from "../utils/command-routing-static.js";
import {
  createJsWorkerTarget,
  createNativeForwardingEnv,
  type LaunchTarget,
} from "./launch-target.js";
import {
  ENV_CLI_BINARY,
  ENV_CLI_DISABLE_LOCAL_FAST_PATH,
  ENV_CLI_DISABLE_NATIVE,
  hasExplicitBinaryOverride,
  hasExplicitJsWorkerOverride,
  isLauncherFlagEnabled,
  resolveInstalledNativeBinary,
} from "./native-resolution.js";

const STATIC_DISCOVERY_COMMANDS = new Set<string>(
  [...GENERATED_STATIC_LOCAL_COMMANDS].filter((command) => command !== "completion"),
);
const TOKENIZED_COMMAND_ROUTES = GENERATED_TOKENIZED_COMMAND_ROUTES;

type CliPackageInfoSource = CliPackageInfo | (() => CliPackageInfo);

export type LocalFastPathKind =
  | "version"
  | "root-help"
  | "completion-query"
  | "static-discovery";

export type InvocationPlan =
  | {
      kind: "local-static";
      fastPath: LocalFastPathKind;
      parsed: ParsedRootArgv;
      route: string | null;
    }
  | {
      kind: "inline-js";
      parsed: ParsedRootArgv;
      route: string | null;
      target: LaunchTarget;
    }
  | {
      kind: "spawn-js-worker";
      parsed: ParsedRootArgv;
      route: string | null;
      target: LaunchTarget;
    }
  | {
      kind: "spawn-native";
      parsed: ParsedRootArgv;
      route: string | null;
      target: LaunchTarget;
    };

function resolveCliPackageInfo(
  pkg: CliPackageInfoSource,
): CliPackageInfo {
  return typeof pkg === "function" ? pkg() : pkg;
}

export function resolveCommandRoute(tokens: string[]): string | null {
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
    if (isDetailView) {
      return nativeModes.includes("default-detail");
    }
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

export function invocationRequiresJsWorker(parsed: ParsedRootArgv): boolean {
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

  if (route === "completion" && hasLongFlag(parsed.argv, "--install")) {
    return true;
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

function resolveLocalFastPathKind(
  parsed: ParsedRootArgv,
  env: NodeJS.ProcessEnv = process.env,
): LocalFastPathKind | null {
  if (
    hasExplicitBinaryOverride(env) ||
    hasExplicitJsWorkerOverride(env) ||
    isLauncherFlagEnabled(env[ENV_CLI_DISABLE_LOCAL_FAST_PATH])
  ) {
    return null;
  }

  if (parsed.isVersionLike && parsed.firstCommandToken === undefined) {
    return "version";
  }

  if (parsed.isRootHelpInvocation) {
    return "root-help";
  }

  if (
    !parsed.isHelpLike &&
    !parsed.isVersionLike &&
    parsed.firstCommandToken === "completion"
  ) {
    return "completion-query";
  }

  if (
    !parsed.isHelpLike &&
    !parsed.isVersionLike &&
    STATIC_DISCOVERY_COMMANDS.has(parsed.firstCommandToken ?? "")
  ) {
    return "static-discovery";
  }

  return null;
}

export function resolveLaunchTarget(
  pkg: CliPackageInfoSource,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  options: {
    resolveInstalledNativeBinary?: typeof resolveInstalledNativeBinary;
    parsed?: ParsedRootArgv;
  } = {},
): LaunchTarget {
  if (isLauncherFlagEnabled(env[ENV_CLI_DISABLE_NATIVE])) {
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
  const nativeBinary = resolveInstalledNativeBinaryFn(resolveCliPackageInfo(pkg), {
    env,
  });
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

export function resolveInvocationPlan(
  pkg: CliPackageInfoSource,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  options: {
    resolveInstalledNativeBinary?: typeof resolveInstalledNativeBinary;
    parsed?: ParsedRootArgv;
    skipLocalFastPath?: boolean;
  } = {},
): InvocationPlan {
  const parsed = options.parsed ?? parseRootArgv(argv);
  const route = resolveCommandRoute(parsed.nonOptionTokens);
  if (!options.skipLocalFastPath) {
    const fastPath = resolveLocalFastPathKind(parsed, env);
    if (fastPath) {
      return {
        kind: "local-static",
        fastPath,
        parsed,
        route,
      };
    }
  }

  const target = resolveLaunchTarget(pkg, argv, env, {
    parsed,
    resolveInstalledNativeBinary: options.resolveInstalledNativeBinary,
  });

  if (target.kind === "native-binary") {
    return {
      kind: "spawn-native",
      parsed,
      route,
      target,
    };
  }

  if (hasExplicitJsWorkerOverride(target.env)) {
    return {
      kind: "spawn-js-worker",
      parsed,
      route,
      target,
    };
  }

  return {
    kind: "inline-js",
    parsed,
    route,
    target,
  };
}

export const invocationPlanTestInternals = {
  resolveLocalFastPathKind,
};
