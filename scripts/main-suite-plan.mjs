import { availableParallelism } from "node:os";
import { collectTestFiles } from "./test-file-collector.mjs";
import {
  chunkList,
  collectDeterministicTestFiles,
} from "./lib/suite-plan-utils.mjs";

export const DEFAULT_MAIN_BATCH_SIZE = 20;
// Keep the default main-batch cap conservative enough that subprocess-heavy
// acceptance and built-CLI lanes do not trip their own command timeouts under
// local CPU contention. Operators can still raise this with
// PP_TEST_MAIN_CONCURRENCY when they explicitly want to trade stability for
// throughput on a faster host.
export const DEFAULT_MAIN_CONCURRENCY_CAP = 2;
export const DEFAULT_ISOLATED_CONCURRENCY_CAP = 2;

const SHARED_BUILT_WORKSPACE_SNAPSHOT_TEST_PATTERNS = [
  /^\.\/test\/acceptance\//,
  /^\.\/test\/integration\//,
  /^\.\/test\/services\/workflow\.anvil\.service\.test\.ts$/,
  /^\.\/test\/unit\/cli-built-helper\.unit\.test\.ts$/,
  /^\.\/test\/conformance\/native-manifest\.conformance\.test\.ts$/,
];

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

  return testBatches.flatMap(({
    label,
    targets,
    batchSize: targetBatchSize,
    tags = [],
    budgetMs = null,
    fixtureClass = null,
  }) => {
    const effectiveBatchSize = targetBatchSize ?? batchSize;
    if (!Number.isInteger(effectiveBatchSize) || effectiveBatchSize <= 0) {
      throw new Error("main batch size must be a positive integer");
    }

    const files = collectDeterministicTestFiles({
      rootDir,
      targets,
      excludedTests,
      collectTestFilesFn,
    });

    return chunkList(files, effectiveBatchSize).map((tests, index, chunks) => ({
      label:
        chunks.length === 1
          ? `main:${label}`
          : `main:${label}-${String(index + 1).padStart(2, "0")}`,
      tests,
      tags,
      budgetMs,
      fixtureClass,
    }));
  });
}

export function suiteUsesSharedBuiltWorkspaceSnapshot(tests) {
  return tests.some((testPath) =>
    SHARED_BUILT_WORKSPACE_SNAPSHOT_TEST_PATTERNS.some((pattern) =>
      pattern.test(testPath)
    )
  );
}

function parsePositiveInteger(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveMainBatchConcurrency({
  suiteCount,
  env = process.env,
  availableParallelismFn = availableParallelism,
  cap = DEFAULT_MAIN_CONCURRENCY_CAP,
}) {
  if (!Number.isInteger(suiteCount) || suiteCount <= 0) {
    return 1;
  }

  const configured = parsePositiveInteger(env.PP_TEST_MAIN_CONCURRENCY);
  if (configured !== null) {
    return Math.min(configured, suiteCount);
  }

  const detected = availableParallelismFn();
  const boundedDetected = Number.isInteger(detected) && detected > 1
    ? Math.max(1, detected - 1)
    : 1;

  return Math.max(1, Math.min(cap, suiteCount, boundedDetected));
}

export function resolveMainBatchRespectFixtureClass({
  env = process.env,
} = {}) {
  // The default keeps the legacy gate in place: subprocess-boundary main
  // batches (acceptance, integration) cannot overlap. Setting
  // PP_TEST_MAIN_RESPECT_FIXTURE_CLASS=0 lifts that restriction so heavy
  // batches can interleave on a host with enough CPU/IO headroom.
  return env.PP_TEST_MAIN_RESPECT_FIXTURE_CLASS !== "0";
}

export function resolveIsolatedSuiteConcurrency({
  suiteCount,
  env = process.env,
  availableParallelismFn = availableParallelism,
  cap = DEFAULT_ISOLATED_CONCURRENCY_CAP,
}) {
  if (!Number.isInteger(suiteCount) || suiteCount <= 0) {
    return 1;
  }

  const configured = parsePositiveInteger(env.PP_TEST_ISOLATED_CONCURRENCY);
  if (configured !== null) {
    return Math.min(configured, suiteCount);
  }

  const detected = availableParallelismFn();
  const boundedDetected = Number.isInteger(detected) && detected > 2
    ? Math.max(1, detected - 2)
    : 1;

  return Math.max(1, Math.min(cap, suiteCount, boundedDetected));
}
