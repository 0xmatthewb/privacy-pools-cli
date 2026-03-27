import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * @typedef {{
 *   binaryPath?: string;
 *   sha256?: string;
 *   bridgeVersion?: string;
 *   protocolVersion?: string;
 *   protocolProfile?: string;
 *   runtimeVersion?: string;
 *   triplet?: string;
 * }} NativePackageMetadata
 *
 * @typedef {{
 *   version?: string;
 *   bin?: string | Record<string, string>;
 *   privacyPoolsCliNative?: NativePackageMetadata;
 * }} NativePackageJson
 */

const nativeChecksumCache = new Map();

export function resolveNativeBridgeVersion(metadata = {}) {
  return metadata.bridgeVersion?.trim() || metadata.protocolVersion?.trim() || null;
}

export function resolveNativeBinaryPath(
  packageJsonPath,
  packageJson,
  options = {},
) {
  const metadataBinaryPath =
    packageJson.privacyPoolsCliNative?.binaryPath?.trim() || null;
  if (metadataBinaryPath) {
    return resolve(dirname(packageJsonPath), metadataBinaryPath);
  }

  if (options.allowLegacyBin === false) {
    return null;
  }

  const legacyBinEntry =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.["privacy-pools"];

  if (!legacyBinEntry) {
    return null;
  }

  return resolve(dirname(packageJsonPath), legacyBinEntry);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function clearNativeChecksumCache() {
  nativeChecksumCache.clear();
}

export function hasValidNativeChecksum(packageJson, binaryPath) {
  const expected = packageJson.privacyPoolsCliNative?.sha256?.trim();
  if (!expected) {
    return false;
  }

  try {
    const stats = statSync(binaryPath);
    const cached = nativeChecksumCache.get(binaryPath);
    if (
      cached &&
      cached.expected === expected &&
      cached.size === stats.size &&
      cached.mtimeMs === stats.mtimeMs
    ) {
      return cached.valid;
    }

    const valid = sha256File(binaryPath) === expected;
    nativeChecksumCache.set(binaryPath, {
      expected,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      valid,
    });
    return valid;
  } catch {
    return false;
  }
}

export function hasCompatibleNativeMetadata(packageJson, expected) {
  const metadata = packageJson.privacyPoolsCliNative;
  const actualBridgeVersion = resolveNativeBridgeVersion(metadata);
  if (actualBridgeVersion !== expected.nativeBridgeVersion) {
    return false;
  }

  if (
    metadata?.bridgeVersion &&
    metadata.runtimeVersion?.trim() !== expected.runtimeVersion
  ) {
    return false;
  }

  const protocolProfile = metadata?.protocolProfile?.trim();
  if (protocolProfile && protocolProfile !== expected.protocolProfile) {
    return false;
  }

  return true;
}
