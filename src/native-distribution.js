const UNIX_BINARY_FILE = "privacy-pools-cli-native-shell";
const WINDOWS_BINARY_FILE = "privacy-pools-cli-native-shell.exe";

export const SUPPORTED_NATIVE_DISTRIBUTIONS = Object.freeze([
  Object.freeze({
    triplet: "darwin-arm64",
    packageName: "@0xbow/privacy-pools-cli-native-macos-arm64",
    platform: "darwin",
    arch: "arm64",
    os: Object.freeze(["darwin"]),
    cpu: Object.freeze(["arm64"]),
    libc: undefined,
    binaryFileName: UNIX_BINARY_FILE,
    displayName: "macOS (Apple Silicon)",
  }),
  Object.freeze({
    triplet: "darwin-x64",
    packageName: "@0xbow/privacy-pools-cli-native-macos-x64",
    platform: "darwin",
    arch: "x64",
    os: Object.freeze(["darwin"]),
    cpu: Object.freeze(["x64"]),
    libc: undefined,
    binaryFileName: UNIX_BINARY_FILE,
    displayName: "macOS (Intel)",
  }),
  Object.freeze({
    triplet: "linux-x64-gnu",
    packageName: "@0xbow/privacy-pools-cli-native-linux-x64-gnu",
    platform: "linux",
    arch: "x64",
    os: Object.freeze(["linux"]),
    cpu: Object.freeze(["x64"]),
    libc: Object.freeze(["glibc"]),
    binaryFileName: UNIX_BINARY_FILE,
    displayName: "Linux (x64, glibc)",
  }),
  Object.freeze({
    triplet: "win32-x64-msvc",
    packageName: "@0xbow/privacy-pools-cli-native-windows-x64-msvc",
    platform: "win32",
    arch: "x64",
    os: Object.freeze(["win32"]),
    cpu: Object.freeze(["x64"]),
    libc: undefined,
    binaryFileName: WINDOWS_BINARY_FILE,
    displayName: "Windows (x64, MSVC)",
  }),
  Object.freeze({
    triplet: "win32-arm64-msvc",
    packageName: "@0xbow/privacy-pools-cli-native-windows-arm64-msvc",
    platform: "win32",
    arch: "arm64",
    os: Object.freeze(["win32"]),
    cpu: Object.freeze(["arm64"]),
    libc: undefined,
    binaryFileName: WINDOWS_BINARY_FILE,
    displayName: "Windows (ARM64, MSVC)",
  }),
]);

const DISTRIBUTION_BY_TRIPLET = new Map(
  SUPPORTED_NATIVE_DISTRIBUTIONS.map((distribution) => [
    distribution.triplet,
    distribution,
  ]),
);

export function getNativeDistributionByTriplet(triplet) {
  return triplet ? DISTRIBUTION_BY_TRIPLET.get(triplet) ?? null : null;
}

function detectLinuxLibcFromSharedObjects(sharedObjects = []) {
  for (const entry of sharedObjects) {
    const normalized = String(entry).toLowerCase();
    if (normalized.includes("musl")) {
      return "musl";
    }
  }

  return null;
}

function detectLinuxLibcFromReport(report) {
  const header = report?.header ?? {};
  if (header.glibcVersionRuntime || header.glibcVersionCompiler) {
    return "glibc";
  }

  return detectLinuxLibcFromSharedObjects(report?.sharedObjects);
}

let cachedProcessLinuxLibc;
let hasCachedProcessLinuxLibc = false;

export function detectLinuxLibc(report = undefined) {
  if (report !== undefined) {
    return detectLinuxLibcFromReport(report);
  }

  if (hasCachedProcessLinuxLibc) {
    return cachedProcessLinuxLibc;
  }

  cachedProcessLinuxLibc = detectLinuxLibcFromReport(
    process.report?.getReport?.(),
  );
  hasCachedProcessLinuxLibc = true;
  return cachedProcessLinuxLibc;
}

export function getNativeDistribution(
  platform = process.platform,
  arch = process.arch,
  libc = platform === "linux" ? detectLinuxLibc() : null,
) {
  for (const distribution of SUPPORTED_NATIVE_DISTRIBUTIONS) {
    if (distribution.platform !== platform || distribution.arch !== arch) {
      continue;
    }

    if (distribution.libc?.length) {
      if (!libc || !distribution.libc.includes(libc)) {
        continue;
      }
    }

    return distribution;
  }

  return null;
}

export function nativeTriplet(
  platform = process.platform,
  arch = process.arch,
  libc = platform === "linux" ? detectLinuxLibc() : null,
) {
  return getNativeDistribution(platform, arch, libc)?.triplet ?? null;
}

export function nativePackageName(
  platform = process.platform,
  arch = process.arch,
  libc = platform === "linux" ? detectLinuxLibc() : null,
) {
  return getNativeDistribution(platform, arch, libc)?.packageName ?? null;
}

export function nativePackageNameForTriplet(triplet) {
  return getNativeDistributionByTriplet(triplet)?.packageName ?? null;
}
