import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliPackageInfo {
  version: string;
  repository?: unknown;
  optionalDependencies?: Record<string, string>;
}

export function readCliPackageInfo(importMetaUrl: string): CliPackageInfo {
  let currentDir = dirname(fileURLToPath(importMetaUrl));

  for (let depth = 0; depth < 6; depth += 1) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return JSON.parse(readFileSync(packageJsonPath, "utf8")) as CliPackageInfo;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  throw new Error("Could not locate package.json for Privacy Pools CLI.");
}
