import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function toRepoRelativePath(rootDir, absolutePath) {
  return `./${normalizePath(relative(rootDir, absolutePath))}`;
}

export function collectTestFiles(pathArg, rootDir = process.cwd()) {
  const absolute = resolve(rootDir, pathArg);
  const stat = statSync(absolute);
  if (stat.isFile()) {
    return [toRepoRelativePath(rootDir, absolute)];
  }

  const files = [];
  const queue = [absolute];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        files.push(toRepoRelativePath(rootDir, entryPath));
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}
