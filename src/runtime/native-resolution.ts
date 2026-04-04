import { createRequire } from "node:module";
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { CliPackageInfo } from "../package-info.js";
import { CLI_PROTOCOL_PROFILE } from "../config/protocol-profile.js";
import { CURRENT_RUNTIME_DESCRIPTOR } from "./runtime-contract.js";
import {
  nativePackageName as resolveNativePackageName,
  nativeTriplet as resolveNativeTriplet,
} from "../native-distribution.js";
import {
  hasCompatibleNativeMetadata,
  hasValidNativeChecksum,
  resolveNativeBinaryPath,
} from "../native-package-metadata.js";
import { resolveConfigHome } from "./config-paths.js";
import { emitRuntimeDiagnostic } from "./diagnostics.js";

export const ENV_CLI_BINARY = "PRIVACY_POOLS_CLI_BINARY";
export const ENV_CLI_DISABLE_NATIVE = "PRIVACY_POOLS_CLI_DISABLE_NATIVE";
export const ENV_CLI_DISABLE_LOCAL_FAST_PATH =
  "PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH";
export const ENV_CLI_JS_WORKER = "PRIVACY_POOLS_CLI_JS_WORKER";
export const ENV_PRIVATE_KEY = "PRIVACY_POOLS_PRIVATE_KEY";

const INSTALLED_NATIVE_VERIFICATION_CACHE_VERSION = 1;
const INSTALLED_NATIVE_VERIFICATION_CACHE_FILE =
  ".native-binary-verification.json";

export interface NativePackageJson {
  version?: string;
  bin?: string | Record<string, string>;
  privacyPoolsCliNative?: {
    binaryPath?: string;
    sha256?: string;
    bridgeVersion?: string;
    protocolProfile?: string;
    runtimeVersion?: string;
    triplet?: string;
  };
}

export interface InstalledNativeVerificationCacheEntry {
  binaryPath: string;
  expectedSha: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  runtimeVersion: string;
  nativeBridgeVersion: string;
  protocolProfile: string;
}

interface InstalledNativeVerificationCache {
  version: number;
  entries: Record<string, InstalledNativeVerificationCacheEntry>;
}

export function isLauncherFlagEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

export function hasExplicitBinaryOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[ENV_CLI_BINARY]?.trim());
}

export function hasExplicitJsWorkerOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[ENV_CLI_JS_WORKER]?.trim());
}

export function installedNativeVerificationCachePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigHome(env), INSTALLED_NATIVE_VERIFICATION_CACHE_FILE);
}

export function readInstalledNativeVerificationCache(
  env: NodeJS.ProcessEnv = process.env,
): InstalledNativeVerificationCache | null {
  try {
    const raw = readFileSync(installedNativeVerificationCachePath(env), "utf8");
    const parsed = JSON.parse(raw) as {
      version?: number;
      entries?: Record<string, InstalledNativeVerificationCacheEntry>;
    };
    if (
      parsed.version !== INSTALLED_NATIVE_VERIFICATION_CACHE_VERSION ||
      typeof parsed.entries !== "object" ||
      parsed.entries === null
    ) {
      return null;
    }
    return {
      version: parsed.version,
      entries: parsed.entries,
    };
  } catch {
    return null;
  }
}

function writeInstalledNativeVerificationCache(
  cache: InstalledNativeVerificationCache,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const cacheHome = resolveConfigHome(env);
  if (!existsSync(cacheHome)) {
    return;
  }

  const targetPath = installedNativeVerificationCachePath(env);
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(cache), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tempPath, targetPath);
  } catch {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best effort cleanup only.
    }
  }
}

export function clearInstalledNativeVerificationCache(
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    unlinkSync(installedNativeVerificationCachePath(env));
  } catch {
    // Best effort cleanup only.
  }
}

export function createInstalledNativeVerificationCacheEntry(
  packageJson: NativePackageJson,
  binaryPath: string,
): InstalledNativeVerificationCacheEntry | null {
  const metadata = packageJson.privacyPoolsCliNative;
  const expectedSha = metadata?.sha256?.trim();
  const runtimeVersion = metadata?.runtimeVersion?.trim();
  const nativeBridgeVersion = metadata?.bridgeVersion?.trim();
  const protocolProfile = metadata?.protocolProfile?.trim() || "";
  if (!expectedSha || !runtimeVersion || !nativeBridgeVersion) {
    return null;
  }

  try {
    const stats = statSync(binaryPath);
    return {
      binaryPath,
      expectedSha,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      runtimeVersion,
      nativeBridgeVersion,
      protocolProfile,
    };
  } catch {
    return null;
  }
}

export function hasInstalledNativeVerificationCacheHit(
  entry: InstalledNativeVerificationCacheEntry,
  env: NodeJS.ProcessEnv = process.env,
  cache: InstalledNativeVerificationCache | null = readInstalledNativeVerificationCache(env),
): boolean {
  const cached = cache?.entries[entry.binaryPath];
  if (!cached) {
    return false;
  }

  return (
    cached.binaryPath === entry.binaryPath &&
    cached.expectedSha === entry.expectedSha &&
    cached.size === entry.size &&
    cached.mtimeMs === entry.mtimeMs &&
    cached.ctimeMs === entry.ctimeMs &&
    cached.runtimeVersion === entry.runtimeVersion &&
    cached.nativeBridgeVersion === entry.nativeBridgeVersion &&
    cached.protocolProfile === entry.protocolProfile
  );
}

function recordInstalledNativeVerificationCacheEntry(
  entry: InstalledNativeVerificationCacheEntry,
  env: NodeJS.ProcessEnv = process.env,
  cache: InstalledNativeVerificationCache | null = readInstalledNativeVerificationCache(env),
): void {
  const nextCache = cache ?? {
    version: INSTALLED_NATIVE_VERIFICATION_CACHE_VERSION,
    entries: {},
  };
  nextCache.entries[entry.binaryPath] = entry;
  writeInstalledNativeVerificationCache(nextCache, env);
}

export function nativeTriplet(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  libc: string | null | undefined = platform === "linux" ? undefined : null,
): string | null {
  return resolveNativeTriplet(platform, arch, libc);
}

export function nativePackageName(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  libc: string | null | undefined = platform === "linux" ? undefined : null,
): string | null {
  return resolveNativePackageName(platform, arch, libc);
}

export function hasCompatibleInstalledNativeMetadata(
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
    env?: NodeJS.ProcessEnv;
    requireResolve?: (id: string) => string;
    hasValidChecksum?: typeof hasValidNativeChecksum;
    recordVerificationCache?: boolean;
  } = {},
): string | null {
  const packageName = nativePackageName(options.platform, options.arch);
  if (!packageName) {
    emitRuntimeDiagnostic(
      "native-skip",
      { reason: "unsupported-host" },
      options.env,
    );
    return null;
  }

  const requireResolve =
    options.requireResolve ?? createRequire(import.meta.url).resolve;

  try {
    const packageJsonPath = requireResolve(`${packageName}/package.json`);
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    ) as NativePackageJson;

    if (packageJson.version !== pkg.version) {
      emitRuntimeDiagnostic(
        "native-skip",
        {
          package: packageName,
          reason: "version-mismatch",
          expectedVersion: pkg.version,
          installedVersion: packageJson.version ?? "<missing>",
        },
        options.env,
      );
      return null;
    }

    if (!hasCompatibleInstalledNativeMetadata(packageJson)) {
      emitRuntimeDiagnostic(
        "native-skip",
        {
          package: packageName,
          reason: "metadata-mismatch",
        },
        options.env,
      );
      return null;
    }

    const binaryPath = resolveNativeBinaryPath(packageJsonPath, packageJson);
    if (!binaryPath) {
      emitRuntimeDiagnostic(
        "native-skip",
        {
          package: packageName,
          reason: "missing-binary-path",
        },
        options.env,
      );
      return null;
    }
    const cacheEntry = createInstalledNativeVerificationCacheEntry(
      packageJson,
      binaryPath,
    );
    if (!cacheEntry) {
      emitRuntimeDiagnostic(
        "native-skip",
        {
          package: packageName,
          reason: "invalid-verification-metadata",
        },
        options.env,
      );
      return null;
    }
    const installedVerificationCache = readInstalledNativeVerificationCache(
      options.env,
    );
    if (
      hasInstalledNativeVerificationCacheHit(
        cacheEntry,
        options.env,
        installedVerificationCache,
      )
    ) {
      emitRuntimeDiagnostic(
        "native-cache",
        {
          package: packageName,
          hit: true,
        },
        options.env,
      );
      return binaryPath;
    }
    emitRuntimeDiagnostic(
      "native-cache",
      {
        package: packageName,
        hit: false,
      },
      options.env,
    );
    const hasValidChecksum =
      options.hasValidChecksum ?? hasValidNativeChecksum;
    if (!hasValidChecksum(packageJson, binaryPath)) {
      emitRuntimeDiagnostic(
        "native-verify",
        {
          package: packageName,
          status: "checksum-mismatch",
        },
        options.env,
      );
      return null;
    }
    if (options.recordVerificationCache !== false) {
      recordInstalledNativeVerificationCacheEntry(
        cacheEntry,
        options.env,
        installedVerificationCache,
      );
      emitRuntimeDiagnostic(
        "native-cache",
        {
          package: packageName,
          recorded: true,
        },
        options.env,
      );
    }

    return binaryPath;
  } catch {
    emitRuntimeDiagnostic(
      "native-skip",
      {
        package: packageName,
        reason: "resolve-failed",
      },
      options.env,
    );
    return null;
  }
}
