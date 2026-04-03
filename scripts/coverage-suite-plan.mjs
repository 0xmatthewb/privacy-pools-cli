import { collectTestFiles } from "./test-file-collector.mjs";
import {
  chunkList,
  collectDeterministicTestFiles,
} from "./lib/suite-plan-utils.mjs";

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

  const files = collectDeterministicTestFiles({
    rootDir,
    targets: testTargets,
    excludedTests,
    collectTestFilesFn,
    extraTests: commandSurfaceTests,
  });

  return chunkList(files, batchSize).map((tests, index) => ({
    label: `main-${String(index + 1).padStart(2, "0")}`,
    tests,
  }));
}
