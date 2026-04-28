import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CliPackageInfo } from "./package-info.js";
import { NATIVE_JS_BRIDGE_ENV } from "./runtime/current.js";
import {
  ENV_CLI_BINARY,
  ENV_CLI_DISABLE_NATIVE,
  nativePackageName as resolveNativePackageName,
  resolveInstalledNativeBinary,
} from "./runtime/native-resolution.js";
import type { StatusIssue } from "./types.js";

export type ActiveRuntimeKind = "native" | "js";

export function detectActiveRuntimeKind(
  env: NodeJS.ProcessEnv = process.env,
): ActiveRuntimeKind {
  return env[NATIVE_JS_BRIDGE_ENV]?.trim() ? "native" : "js";
}

export interface NativeRuntimeAdvisoryDependencies {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  libc?: string | null;
  nativePackageName?: (
    platform?: NodeJS.Platform,
    arch?: NodeJS.Architecture,
    libc?: string | null,
  ) => string | null;
  resolveInstalledNativeBinary?: (
    pkg: CliPackageInfo,
    options?: {
      platform?: NodeJS.Platform;
      arch?: NodeJS.Architecture;
      env?: NodeJS.ProcessEnv;
      recordVerificationCache?: boolean;
    },
  ) => string | null;
  isSourceCheckout?: (packageRoot: string) => boolean;
}

function isFlagEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

function defaultIsSourceCheckout(packageRoot: string): boolean {
  return existsSync(join(packageRoot, ".git"));
}

export function detectNativeRuntimeAdvisory(
  pkg: CliPackageInfo,
  deps: NativeRuntimeAdvisoryDependencies = {},
): StatusIssue | null {
  const env = deps.env ?? process.env;
  if (
    isFlagEnabled(env[ENV_CLI_DISABLE_NATIVE]) ||
    env[ENV_CLI_BINARY]?.trim()
  ) {
    return null;
  }

  const packageName = (
    deps.nativePackageName ?? resolveNativePackageName
  )(
    deps.platform,
    deps.arch,
    deps.libc,
  );
  if (!packageName) {
    return null;
  }

  const isSourceCheckout =
    deps.isSourceCheckout ?? defaultIsSourceCheckout;
  if (isSourceCheckout(pkg.packageRoot)) {
    return null;
  }

  const installedBinary = (
    deps.resolveInstalledNativeBinary ?? resolveInstalledNativeBinary
  )(pkg, {
    platform: deps.platform,
    arch: deps.arch,
    env,
  });
  if (installedBinary) {
    return null;
  }

  return {
    code: "native_acceleration_unavailable",
    message:
      "The optional native runtime for this supported host is unavailable or invalid, so the CLI is using the safe JS path. All commands remain available, but read-only discovery commands may be slower. Reinstall without --omit=optional and ensure optional dependencies are enabled.",
    affects: ["discovery"],
  };
}
