import { resolve } from "node:path";

export function normalizeSuitePath(value) {
  return value.replaceAll("\\", "/");
}

export function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function collectDeterministicTestFiles({
  rootDir,
  targets,
  excludedTests = [],
  collectTestFilesFn,
  extraTests = [],
}) {
  const excluded = new Set(
    excludedTests.map((target) => normalizeSuitePath(resolve(rootDir, target))),
  );
  const seen = new Set();

  return [
    ...targets.flatMap((target) => collectTestFilesFn(target, rootDir)),
    ...extraTests,
  ]
    .filter((target) => {
      const normalizedAbsolute = normalizeSuitePath(resolve(rootDir, target));
      if (excluded.has(normalizedAbsolute) || seen.has(normalizedAbsolute)) {
        return false;
      }
      seen.add(normalizedAbsolute);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}
