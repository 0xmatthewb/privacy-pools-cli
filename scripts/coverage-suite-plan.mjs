import { resolve } from "node:path";
import { collectTestFiles } from "./test-file-collector.mjs";

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export const DEFAULT_COVERAGE_MAIN_BATCH_SIZE = 10;

export function buildCoverageMainSuites({
  rootDir,
  testTargets,
  commandSurfaceTests,
  excludedTests,
  batchSize = DEFAULT_COVERAGE_MAIN_BATCH_SIZE,
  collectTestFilesFn = collectTestFiles,
}) {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("coverage batch size must be a positive integer");
  }

  const excluded = new Set(
    excludedTests.map((target) => normalizePath(resolve(rootDir, target))),
  );
  const seen = new Set();
  const files = [
    ...testTargets.flatMap((target) => collectTestFilesFn(target, rootDir)),
    ...commandSurfaceTests,
  ]
    .filter((target) => {
      const normalizedAbsolute = normalizePath(resolve(rootDir, target));
      if (excluded.has(normalizedAbsolute) || seen.has(normalizedAbsolute)) {
        return false;
      }
      seen.add(normalizedAbsolute);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));

  return chunkList(files, batchSize).map((tests, index) => ({
    label: `main-${String(index + 1).padStart(2, "0")}`,
    tests,
  }));
}
