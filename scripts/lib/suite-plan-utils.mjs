import { resolve } from "node:path";

export function normalizeSuitePath(value) {
  return value.replaceAll("\\", "/");
}

export function normalizeTags(tags = []) {
  return [...new Set(
    tags
      .flatMap((tag) => String(tag ?? "").split(","))
      .map((tag) => tag.trim())
      .filter(Boolean),
  )].sort();
}

export function matchesTagFilters(
  tags = [],
  includeTags = [],
  excludeTags = [],
) {
  const normalizedTags = normalizeTags(tags);
  const normalizedIncluded = normalizeTags(includeTags);
  const normalizedExcluded = normalizeTags(excludeTags);

  if (
    normalizedExcluded.length > 0
    && normalizedExcluded.some((tag) => normalizedTags.includes(tag))
  ) {
    return false;
  }

  if (normalizedIncluded.length === 0) {
    return true;
  }

  return normalizedIncluded.every((tag) => normalizedTags.includes(tag));
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
