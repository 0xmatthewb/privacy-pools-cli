import { existsSync } from "node:fs";
import { resolve } from "node:path";

const FLAGS_WITH_VALUES = new Set([
  "--bail",
  "--coverage-dir",
  "--coverage-reporter",
  "--exclude-tag",
  "--exclude",
  "--filter",
  "--max-concurrency",
  "--preload",
  "--process-timeout-ms",
  "--reporter",
  "--rerun-each",
  "--seed",
  "--tag",
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

export function hasExplicitProcessTimeoutArg(args) {
  return args.some((token) => {
    const normalized = normalizeFlagToken(token);
    return normalized === "--process-timeout-ms";
  });
}

function parseProcessTimeout(rawValue) {
  const processTimeoutMs = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(processTimeoutMs) || processTimeoutMs <= 0) {
    throw new Error("--process-timeout-ms must be a positive integer");
  }
  return processTimeoutMs;
}

function parseTagListValue(rawValue, flagName) {
  const tags = rawValue
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (tags.length === 0) {
    throw new Error(`${flagName} requires at least one non-empty tag`);
  }

  return tags;
}

export function extractProcessTimeoutArg(
  args,
  defaultProcessTimeoutMs = null,
) {
  const forwardedArgs = [];
  let processTimeoutMs = defaultProcessTimeoutMs;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--process-timeout-ms") {
      const rawValue = args[i + 1];
      if (!rawValue) {
        throw new Error("--process-timeout-ms requires a value");
      }
      processTimeoutMs = parseProcessTimeout(rawValue);
      i += 1;
      continue;
    }

    if (token.startsWith("--process-timeout-ms=")) {
      processTimeoutMs = parseProcessTimeout(token.split("=", 2)[1] ?? "");
      continue;
    }

    forwardedArgs.push(token);
  }

  return {
    args: forwardedArgs,
    processTimeoutMs,
  };
}

export function extractTagArgs(args) {
  const forwardedArgs = [];
  const includeTags = [];
  const excludeTags = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--tag") {
      const rawValue = args[i + 1];
      if (!rawValue) {
        throw new Error("--tag requires a value");
      }
      includeTags.push(...parseTagListValue(rawValue, "--tag"));
      i += 1;
      continue;
    }

    if (token.startsWith("--tag=")) {
      includeTags.push(
        ...parseTagListValue(token.split("=", 2)[1] ?? "", "--tag"),
      );
      continue;
    }

    if (token === "--exclude-tag") {
      const rawValue = args[i + 1];
      if (!rawValue) {
        throw new Error("--exclude-tag requires a value");
      }
      excludeTags.push(...parseTagListValue(rawValue, "--exclude-tag"));
      i += 1;
      continue;
    }

    if (token.startsWith("--exclude-tag=")) {
      excludeTags.push(
        ...parseTagListValue(
          token.split("=", 2)[1] ?? "",
          "--exclude-tag",
        ),
      );
      continue;
    }

    forwardedArgs.push(token);
  }

  return {
    args: forwardedArgs,
    includeTags: [...new Set(includeTags)].sort(),
    excludeTags: [...new Set(excludeTags)].sort(),
  };
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
