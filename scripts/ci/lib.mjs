import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAIN_EXCLUDED_TESTS,
  DEFAULT_MAIN_TEST_TARGETS,
  DEFAULT_TEST_ISOLATED_SUITES,
} from "../test-suite-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SHARD_WEIGHT_MANIFEST = resolve(
  ROOT,
  "scripts/ci/test-shard-weights.json",
);

const JOB_RULES = {
  "linux-core": [
    "src/",
    "test/",
    "scripts/",
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "bunfig.toml",
    ".github/workflows/ci.yml",
  ],
  "packaged-smoke": [
    "src/",
    "scripts/start-built-cli.mjs",
    "scripts/clean-dist.mjs",
    "package.json",
    "bun.lock",
    "AGENTS.md",
    "CHANGELOG.md",
    "docs/reference.md",
    "skills/",
    ".github/workflows/ci.yml",
    ".github/workflows/cross-platform.yml",
  ],
  "anvil-e2e-smoke": [
    "src/",
    "scripts/anvil*",
    "scripts/run-anvil*",
    "test/helpers/anvil*",
    "test/helpers/shared-anvil*",
    "test/integration/cli-anvil*",
    "test/services/workflow.anvil*",
    "package.json",
    "bun.lock",
    ".github/workflows/ci.yml",
    ".github/workflows/full-anvil.yml",
    ".github/workflows/release.yml",
  ],
  "coverage-guard": [
    "src/",
    "test/unit/",
    "test/services/",
    "test/acceptance/",
    "scripts/check-coverage.mjs",
    "scripts/test-suite-manifest.mjs",
    "scripts/run-test-suite.mjs",
    "scripts/run-bun-tests.mjs",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    ".github/workflows/ci.yml",
  ],
  evals: [
    "src/",
    "test/evals/",
    "AGENTS.md",
    "docs/reference.md",
    "skills/",
    "package.json",
    "bun.lock",
    ".github/workflows/ci.yml",
  ],
  "conformance-core": [
    "src/",
    "docs/",
    "AGENTS.md",
    "README.md",
    "skills/",
    "CHANGELOG.md",
    "scripts/generate-reference.mjs",
    "scripts/generate-command-discovery-static.mjs",
    "test/conformance/",
    "package.json",
    "bun.lock",
    ".github/workflows/ci.yml",
    ".github/workflows/conformance.yml",
  ],
  "cross-platform": [
    "src/",
    "scripts/start-built-cli.mjs",
    "scripts/clean-dist.mjs",
    "package.json",
    "bun.lock",
    "AGENTS.md",
    "CHANGELOG.md",
    "docs/reference.md",
    "skills/",
    ".github/workflows/cross-platform.yml",
  ],
  "frontend-parity": [
    "src/services/",
    "src/config/",
    "docs/",
    "AGENTS.md",
    "skills/",
    "test/conformance/",
    "package.json",
    "bun.lock",
    ".github/workflows/frontend-parity.yml",
  ],
  "full-anvil": [
    "src/",
    "scripts/anvil*",
    "scripts/run-anvil*",
    "test/helpers/anvil*",
    "test/helpers/shared-anvil*",
    "test/integration/cli-anvil*",
    "test/services/workflow.anvil*",
    "package.json",
    "bun.lock",
    ".github/workflows/full-anvil.yml",
    ".github/workflows/release.yml",
  ],
  "flake-core": [
    "src/",
    "test/",
    "scripts/",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    ".github/workflows/flake.yml",
  ],
};

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function fileMatchesRule(filePath, rule) {
  const normalizedFile = normalizePath(filePath);
  const normalizedRule = normalizePath(rule);
  if (normalizedRule.endsWith("*")) {
    return normalizedFile.startsWith(normalizedRule.slice(0, -1));
  }
  if (normalizedRule.endsWith("/")) {
    return normalizedFile.startsWith(normalizedRule);
  }
  return normalizedFile === normalizedRule;
}

export function evaluateJobSelection({
  job,
  changedFiles,
  eventName = "pull_request",
}) {
  if (eventName !== "pull_request") {
    return {
      shouldRun: true,
      reason: `${eventName} runs the full test matrix`,
    };
  }

  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return {
      shouldRun: true,
      reason: "Changed files were unavailable; running defensively",
    };
  }

  const rules = JOB_RULES[job];
  if (!rules) {
    return {
      shouldRun: true,
      reason: `No selection rules configured for ${job}; running defensively`,
    };
  }

  const matchedFiles = changedFiles.filter((filePath) =>
    rules.some((rule) => fileMatchesRule(filePath, rule)),
  );

  return matchedFiles.length > 0
    ? {
        shouldRun: true,
        reason: `Relevant changes detected: ${matchedFiles.slice(0, 5).join(", ")}`,
      }
    : {
        shouldRun: false,
        reason: `No changes matched the ${job} job rules`,
      };
}

export function resolveChangedFiles({
  eventName = process.env.GITHUB_EVENT_NAME,
  baseRef = process.env.GITHUB_BASE_REF ?? "main",
  cwd = ROOT,
} = {}) {
  if (eventName !== "pull_request") {
    return [];
  }

  try {
    const mergeBase = execFileSync(
      "git",
      ["merge-base", "HEAD", `origin/${baseRef}`],
      { cwd, encoding: "utf8" },
    ).trim();
    if (!mergeBase) {
      return [];
    }

    const diff = execFileSync(
      "git",
      ["diff", "--name-only", `${mergeBase}...HEAD`],
      { cwd, encoding: "utf8" },
    );

    return diff
      .split("\n")
      .map((line) => normalizePath(line.trim()))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function collectTestFiles(pathArg) {
  const absolute = resolve(ROOT, pathArg);
  const stat = statSync(absolute);
  if (stat.isFile()) {
    return [normalizePath(pathArg)];
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
        files.push(`./${normalizePath(relative(ROOT, entryPath))}`);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export function collectLinuxCoreTestFiles(rootDir = ROOT) {
  const excluded = new Set(
    DEFAULT_MAIN_EXCLUDED_TESTS.map((filePath) => resolve(rootDir, filePath)),
  );

  const mainFiles = DEFAULT_MAIN_TEST_TARGETS.flatMap((target) =>
    collectTestFiles(target).filter(
      (candidate) => !excluded.has(resolve(rootDir, candidate)),
    ),
  );

  const isolatedFiles = DEFAULT_TEST_ISOLATED_SUITES.flatMap((suite) => suite.tests);
  return uniqueSorted([...mainFiles, ...isolatedFiles]);
}

let cachedShardWeights;

function loadShardWeights() {
  if (cachedShardWeights !== undefined) {
    return cachedShardWeights;
  }

  try {
    const parsed = JSON.parse(readFileSync(SHARD_WEIGHT_MANIFEST, "utf8"));
    cachedShardWeights = Object.fromEntries(
      Object.entries(parsed).map(([filePath, weight]) => [
        normalizePath(filePath),
        Number(weight),
      ]),
    );
  } catch {
    cachedShardWeights = {};
  }

  return cachedShardWeights;
}

export function resolveFileWeight(filePath, rootDir = ROOT) {
  const configuredWeight = loadShardWeights()[normalizePath(filePath)];
  if (Number.isFinite(configuredWeight) && configuredWeight > 0) {
    return configuredWeight;
  }

  const absolutePath = resolve(rootDir, filePath);
  const contents = readFileSync(absolutePath, "utf8");
  return contents.split("\n").length;
}

export function buildFileShards(files, count, rootDir = ROOT) {
  const shardCount = Math.max(1, count);
  const weighted = uniqueSorted(files)
    .map((filePath) => ({
      filePath,
      weight: resolveFileWeight(filePath, rootDir),
    }))
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight;
      return left.filePath.localeCompare(right.filePath);
    });

  const shards = Array.from({ length: shardCount }, (_, index) => ({
    index: index + 1,
    totalWeight: 0,
    files: [],
  }));

  for (const entry of weighted) {
    const lightestShard = shards.reduce((best, current) =>
      current.totalWeight < best.totalWeight ? current : best,
    );
    lightestShard.files.push(entry.filePath);
    lightestShard.totalWeight += entry.weight;
  }

  return shards.map((shard) => ({
    index: shard.index,
    totalWeight: shard.totalWeight,
    files: shard.files.sort((a, b) => a.localeCompare(b)),
  }));
}

export function shardMatrix(count) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    index: index + 1,
    label: `${index + 1}`,
  }));
}
