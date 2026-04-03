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

export const DEFAULT_MAIN_BATCH_SIZE = 20;

export function buildDefaultMainSuites({
  rootDir,
  testBatches,
  excludedTests,
  batchSize = DEFAULT_MAIN_BATCH_SIZE,
  collectTestFilesFn = collectTestFiles,
}) {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("main batch size must be a positive integer");
  }

  const excluded = new Set(
    excludedTests.map((target) => normalizePath(resolve(rootDir, target))),
  );

  return testBatches.flatMap(({ label, targets, batchSize: targetBatchSize }) => {
    const effectiveBatchSize = targetBatchSize ?? batchSize;
    if (!Number.isInteger(effectiveBatchSize) || effectiveBatchSize <= 0) {
      throw new Error("main batch size must be a positive integer");
    }

    const seen = new Set();
    const files = targets
      .flatMap((target) => collectTestFilesFn(target, rootDir))
      .filter((target) => {
        const normalizedAbsolute = normalizePath(resolve(rootDir, target));
        if (excluded.has(normalizedAbsolute) || seen.has(normalizedAbsolute)) {
          return false;
        }
        seen.add(normalizedAbsolute);
        return true;
      })
      .sort((left, right) => left.localeCompare(right));

    return chunkList(files, effectiveBatchSize).map((tests, index, chunks) => ({
      label:
        chunks.length === 1
          ? `main:${label}`
          : `main:${label}-${String(index + 1).padStart(2, "0")}`,
      tests,
    }));
  });
}
