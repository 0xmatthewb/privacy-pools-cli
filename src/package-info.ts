import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliPackageInfo {
  version: string;
  repository?: unknown;
  optionalDependencies?: Record<string, string>;
}

const PACKAGE_INFO_CACHE = new Map<string, CliPackageInfo>();

export function readCliPackageInfo(importMetaUrl: string): CliPackageInfo {
  const cached = PACKAGE_INFO_CACHE.get(importMetaUrl);
  if (cached) {
    return cached;
  }

  let currentDir = dirname(fileURLToPath(importMetaUrl));

  for (let depth = 0; depth < 6; depth += 1) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageInfo = JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
      ) as CliPackageInfo;
      PACKAGE_INFO_CACHE.set(importMetaUrl, packageInfo);
      return packageInfo;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  throw new Error("Could not locate package.json for Privacy Pools CLI.");
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
