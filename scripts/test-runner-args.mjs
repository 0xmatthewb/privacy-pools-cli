import { existsSync } from "node:fs";
import { resolve } from "node:path";

const FLAGS_WITH_VALUES = new Set([
  "--bail",
  "--coverage-dir",
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
    return normalized === "--timeout" || normalized === "-t";
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
