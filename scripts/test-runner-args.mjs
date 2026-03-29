import { existsSync } from "node:fs";
import { resolve } from "node:path";

const FLAGS_WITH_VALUES = new Set([
  "--bail",
  "--coverage-dir",
  "--coverage-reporter",
  "--exclude",
  "--filter",
  "--max-concurrency",
  "--preload",
  "--reporter",
  "--rerun-each",
  "--seed",
  "--test-name-pattern",
  "--timeout",
  "-t",
]);

function normalizeFlagToken(token) {
  if (!token.startsWith("-")) return token;
  const equalsIndex = token.indexOf("=");
  return equalsIndex === -1 ? token : token.slice(0, equalsIndex);
}

function flagConsumesNextValue(token) {
  if (!token.startsWith("-") || token.includes("=")) return false;
  return FLAGS_WITH_VALUES.has(normalizeFlagToken(token));
}

export function annotateArgs(args) {
  const annotated = [];
  let consumedAsValue = false;

  for (const token of args) {
    annotated.push({ token, consumedAsValue });
    consumedAsValue = !consumedAsValue && flagConsumesNextValue(token);
  }

  return annotated;
}

export function hasExplicitTimeoutArg(args) {
  return args.some((token) => {
    const normalized = normalizeFlagToken(token);
    return normalized === "--timeout";
  });
}

export function hasExplicitTestTarget(args, rootDir = process.cwd()) {
  return annotateArgs(args).some(({ token, consumedAsValue }) => {
    if (consumedAsValue || token.startsWith("-")) return false;
    return existsSync(resolve(rootDir, token));
  });
}

export function expandPathArgsWithExcludes(
  args,
  excludedPaths,
  collectTestFiles,
  rootDir = process.cwd(),
) {
  return annotateArgs(args).flatMap(({ token, consumedAsValue }) => {
    if (consumedAsValue || token.startsWith("-") || !existsSync(resolve(rootDir, token))) {
      return [token];
    }

    return collectTestFiles(token).filter((candidate) => {
      return !excludedPaths.has(resolve(rootDir, candidate));
    });
  });
}

export function splitExplicitTargets(
  args,
  collectTestFiles,
  rootDir = process.cwd(),
) {
  const sharedArgs = [];
  const targetFiles = [];
  const seenTargets = new Set();

  for (const { token, consumedAsValue } of annotateArgs(args)) {
    if (
      consumedAsValue ||
      token.startsWith("-") ||
      !existsSync(resolve(rootDir, token))
    ) {
      sharedArgs.push(token);
      continue;
    }

    for (const candidate of collectTestFiles(token)) {
      const resolvedCandidate = resolve(rootDir, candidate);
      if (seenTargets.has(resolvedCandidate)) continue;
      seenTargets.add(resolvedCandidate);
      targetFiles.push(candidate);
    }
  }

  return {
    sharedArgs,
    targetFiles,
  };
}

export function groupTargetsByIsolation(
  targetFiles,
  isolatedSuites,
  rootDir = process.cwd(),
) {
  const suiteByResolvedTest = new Map();
  for (const suite of isolatedSuites) {
    for (const testPath of suite.tests) {
      suiteByResolvedTest.set(resolve(rootDir, testPath), suite);
    }
  }

  const mainTargets = [];
  const groupedSuites = new Map();

  for (const targetFile of targetFiles) {
    const suite = suiteByResolvedTest.get(resolve(rootDir, targetFile));
    if (!suite) {
      mainTargets.push(targetFile);
      continue;
    }

    const existing = groupedSuites.get(suite.label) ?? {
      ...suite,
      tests: [],
    };
    existing.tests.push(targetFile);
    groupedSuites.set(suite.label, existing);
  }

  return {
    mainTargets,
    isolatedGroups: isolatedSuites
      .map((suite) => groupedSuites.get(suite.label))
      .filter(Boolean),
  };
}
