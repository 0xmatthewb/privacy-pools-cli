import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliPackageInfo {
  version: string;
  repository?: unknown;
  optionalDependencies?: Record<string, string>;
  packageRoot: string;
  packageJsonPath: string;
}

const PACKAGE_INFO_CACHE = new Map<string, CliPackageInfo>();

function resolveCliPackageInfoPaths(
  importMetaUrl: string,
): { packageRoot: string; packageJsonPath: string } {
  let currentDir = dirname(fileURLToPath(importMetaUrl));

  for (let depth = 0; depth < 6; depth += 1) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return {
        packageRoot: currentDir,
        packageJsonPath,
      };
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  throw new Error("Could not locate package.json for Privacy Pools CLI.");
}

export function readCliPackageInfo(importMetaUrl: string): CliPackageInfo {
  const cached = PACKAGE_INFO_CACHE.get(importMetaUrl);
  if (cached) {
    return cached;
  }

  const { packageRoot, packageJsonPath } = resolveCliPackageInfoPaths(
    importMetaUrl,
  );
  const packageInfo = {
    ...(JSON.parse(readFileSync(packageJsonPath, "utf8")) as Omit<
      CliPackageInfo,
      "packageRoot" | "packageJsonPath"
    >),
    packageRoot,
    packageJsonPath,
  } satisfies CliPackageInfo;
  PACKAGE_INFO_CACHE.set(importMetaUrl, packageInfo);
  return packageInfo;
}

export function createCliPackageInfoResolver(
  importMetaUrl: string,
): () => CliPackageInfo {
  let cached: CliPackageInfo | undefined;
  return () => {
    cached ??= readCliPackageInfo(importMetaUrl);
    return cached;
  };
}
