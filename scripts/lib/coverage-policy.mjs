import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export function normalizeCoveragePath(path) {
  return path.replaceAll("\\", "/");
}

export function stripLcovSourceSearchAndHash(source) {
  const queryIndex = source.indexOf("?");
  const hashIndex = source.indexOf("#");
  const cutIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cutIndex === undefined ? source : source.slice(0, cutIndex);
}

export function createCoverageExcludedSources(rootDir) {
  return new Set([
    // Generated artifact/data modules are verified via generation and contract tests
    // rather than raw line-coverage thresholds.
    normalizeCoveragePath(resolve(rootDir, "src/utils/command-manifest.ts")),
    normalizeCoveragePath(resolve(rootDir, "src/services/circuit-checksums.js")),
    normalizeCoveragePath(resolve(rootDir, "src/types.ts")),
    normalizeCoveragePath(resolve(rootDir, "src/static-discovery/types.ts")),
  ]);
}

export const COVERAGE_THRESHOLDS = [
  { label: "overall-src", min: 85, matchers: ["src/"] },
  { label: "services", min: 85, matchers: ["src/services/"] },
  { label: "workflow-engine", min: 85, matchers: ["src/services/workflow.ts"] },
  { label: "commands", min: 85, matchers: ["src/commands/"] },
  { label: "utils", min: 85, matchers: ["src/utils/"] },
  { label: "output", min: 85, matchers: ["src/output/"] },
  { label: "command-shells", min: 85, matchers: ["src/command-shells/"] },
  {
    label: "bootstrap",
    min: 85,
    matchers: [
      "src/program.ts",
      "src/index.ts",
      "src/cli-main.ts",
      "src/static-discovery.ts",
      "src/static-discovery/",
    ],
  },
  {
    label: "launcher-runtime",
    min: 85,
    matchers: [
      "src/launcher.ts",
      "src/runtime/",
      "src/utils/root-argv.ts",
    ],
  },
  { label: "config", min: 95, matchers: ["src/config/"] },
];

export const RISK_COVERAGE_SCORECARD = [
  {
    label: "workflow",
    paths: [
      "src/command-shells/flow.ts",
      "src/commands/flow.ts",
      "src/output/flow.ts",
      "src/services/workflow.ts",
    ],
    target: 90,
  },
  {
    label: "init",
    paths: [
      "src/command-shells/init.ts",
      "src/commands/init.ts",
      "src/output/init.ts",
    ],
    target: 90,
  },
  {
    label: "deposit",
    paths: [
      "src/command-shells/deposit.ts",
      "src/commands/deposit.ts",
      "src/output/deposit.ts",
    ],
    target: 90,
  },
  {
    label: "withdraw",
    paths: [
      "src/command-shells/withdraw.ts",
      "src/commands/withdraw.ts",
      "src/output/withdraw.ts",
    ],
    target: 90,
  },
  {
    label: "ragequit",
    paths: [
      "src/command-shells/ragequit.ts",
      "src/commands/ragequit.ts",
      "src/output/ragequit.ts",
    ],
    target: 90,
  },
  {
    label: "accounts",
    paths: [
      "src/command-shells/accounts.ts",
      "src/commands/accounts.ts",
      "src/output/accounts.ts",
      "src/services/account.ts",
    ],
    target: 90,
  },
  { label: "relayer-service", path: "src/services/relayer.ts", target: 90 },
];

export function isExcludedCoverageSource(source, excludedSources) {
  return excludedSources.has(normalizeCoveragePath(source));
}

function matchesAnyPrefix(source, prefixes) {
  return prefixes.some((prefix) => source.includes(prefix));
}

export function parseCoverageByMatchers(
  matchers,
  coverageMap,
  { excludedSources } = {},
) {
  const effectiveExcludedSources = excludedSources ?? new Set();
  let linesFound = 0;
  let linesHit = 0;

  for (const [normalizedSource, lineHits] of coverageMap.entries()) {
    if (
      isExcludedCoverageSource(normalizedSource, effectiveExcludedSources)
      || !matchesAnyPrefix(normalizedSource, matchers)
    ) {
      continue;
    }

    linesFound += lineHits.size;
    for (const hits of lineHits.values()) {
      if (hits > 0) linesHit += 1;
    }
  }

  return {
    linesFound,
    linesHit,
    percent: linesFound === 0 ? 0 : (linesHit / linesFound) * 100,
  };
}

export function collectTopUncoveredFiles(
  coverageMap,
  { excludedSources, limit = 12 } = {},
) {
  const effectiveExcludedSources = excludedSources ?? new Set();
  const rows = [];

  for (const [source, lineHits] of coverageMap.entries()) {
    if (
      isExcludedCoverageSource(source, effectiveExcludedSources)
      || !source.includes("src/")
    ) {
      continue;
    }

    let missed = 0;
    for (const hits of lineHits.values()) {
      if (hits === 0) missed += 1;
    }
    if (missed === 0) continue;

    const total = lineHits.size;
    const hit = total - missed;
    rows.push({
      source,
      missed,
      total,
      hit,
      percent: total === 0 ? 0 : (hit / total) * 100,
    });
  }

  return rows
    .sort((a, b) => {
      if (b.missed !== a.missed) return b.missed - a.missed;
      return a.source.localeCompare(b.source);
    })
    .slice(0, limit);
}

export function collectCoverageScorecard(
  coverageMap,
  scorecard,
  { excludedSources = new Set(), rootDir = process.cwd() } = {},
) {
  return scorecard.map((entry) => {
    const sources = (entry.paths ?? [entry.path])
      .filter(Boolean)
      .map((sourcePath) => normalizeCoveragePath(resolve(rootDir, sourcePath)));
    let total = 0;
    let hit = 0;
    const missingSources = [];
    const excludedEntrySources = [];

    for (const source of sources) {
      if (isExcludedCoverageSource(source, excludedSources)) {
        excludedEntrySources.push(source);
        continue;
      }

      const lineHits = coverageMap.get(source);
      if (!lineHits) {
        missingSources.push(source);
        continue;
      }

      const executableLines = collectExecutableCoverageLines(source);
      for (const [lineNumber, hits] of lineHits.entries()) {
        if (!executableLines.has(lineNumber)) continue;
        total += 1;
        if (hits > 0) hit += 1;
      }
    }

    const percent = total === 0 ? 0 : (hit / total) * 100;

    return {
      ...entry,
      source: sources.length === 1 ? sources[0] : null,
      sources,
      bundleSize: sources.length,
      measurement: sources.length === 1 ? "file" : "bundle",
      missingSources,
      excludedScorecardSources: excludedEntrySources,
      total,
      hit,
      percent,
      missingFromCoverage:
        missingSources.length > 0 || excludedEntrySources.length > 0,
      belowTarget: total === 0 || percent < entry.target,
    };
  });
}

export function collectExecutableCoverageLines(sourcePath) {
  let sourceLines;
  try {
    sourceLines = readFileSync(sourcePath, "utf8").split("\n");
  } catch {
    return new Set();
  }

  const executableLines = new Set();
  let inBlockComment = false;
  let inTypeDeclaration = false;
  let typeDeclarationBraceDepth = 0;
  let typeDeclarationEndsWithSemicolon = false;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = sourceLines[index].trim();
    let skip = false;

    if (inBlockComment) {
      skip = true;
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
    }

    if (!skip && trimmed.startsWith("/*")) {
      skip = true;
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
    }

    if (!skip && inTypeDeclaration) {
      skip = true;
      typeDeclarationBraceDepth += countTypeDeclarationDepthDelta(trimmed);
      if (typeDeclarationEndsWithSemicolon && trimmed.endsWith(";")) {
        inTypeDeclaration = false;
        typeDeclarationEndsWithSemicolon = false;
        typeDeclarationBraceDepth = 0;
      } else if (
        !typeDeclarationEndsWithSemicolon &&
        typeDeclarationBraceDepth <= 0 &&
        (trimmed.endsWith("}") || trimmed.endsWith("};"))
      ) {
        inTypeDeclaration = false;
        typeDeclarationBraceDepth = 0;
      }
    }

    if (!skip && isTypeDeclarationStart(trimmed)) {
      skip = true;
      typeDeclarationBraceDepth = countTypeDeclarationDepthDelta(trimmed);
      typeDeclarationEndsWithSemicolon =
        /^(export\s+)?type\b/.test(trimmed) && !trimmed.endsWith(";");
      inTypeDeclaration =
        typeDeclarationEndsWithSemicolon || typeDeclarationBraceDepth > 0;
    }

    if (!skip && isNonExecutableCoverageLine(trimmed)) {
      skip = true;
    }

    if (!skip) {
      executableLines.add(lineNumber);
    }
  }

  return executableLines;
}

function countTypeDeclarationDepthDelta(trimmed) {
  const opens = (trimmed.match(/[<{(]/g) ?? []).length;
  const closes = (trimmed.match(/[>})]/g) ?? []).length;
  return opens - closes;
}

function isTypeDeclarationStart(trimmed) {
  return /^(export\s+)?(interface|type)\b/.test(trimmed);
}

function isNonExecutableCoverageLine(trimmed) {
  if (trimmed === "") return true;
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("*") || trimmed.startsWith("*/")) return true;
  if (trimmed.startsWith("|")) return true;
  return new Set([
    "{",
    "}",
    "(",
    ")",
    "[",
    "]);",
    "];",
    "},",
    "});",
    "};",
    ");",
  ]).has(trimmed);
}

export function collectExecutableSourceFiles(
  rootDir,
  { excludedSources = createCoverageExcludedSources(rootDir) } = {},
) {
  const files = [];
  const queue = [resolve(rootDir, "src")];

  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (extname(entry.name) !== ".ts" && extname(entry.name) !== ".js") {
        continue;
      }
      if (entry.name.endsWith(".d.ts")) continue;

      files.push(normalizeCoveragePath(entryPath));
    }
  }

  return files
    .filter((source) => !isExcludedCoverageSource(source, excludedSources))
    .sort((a, b) => a.localeCompare(b));
}

export function evaluateCoveragePolicy({
  rootDir,
  coverageMap,
  thresholds = COVERAGE_THRESHOLDS,
  excludedSources = createCoverageExcludedSources(rootDir),
}) {
  const failures = [];
  const executableSources = collectExecutableSourceFiles(rootDir, {
    excludedSources,
  });
  const uninstrumentedSources = executableSources.filter((source) => {
    return !coverageMap.has(source);
  });

  if (uninstrumentedSources.length > 0) {
    failures.push(
      `${uninstrumentedSources.length} executable src file(s) were missing from LCOV instrumentation`,
    );
  }

  const thresholdResults = thresholds.map((threshold) => {
    const stats = parseCoverageByMatchers(threshold.matchers, coverageMap, {
      excludedSources,
    });

    let failure = null;
    if (stats.linesFound === 0) {
      failure =
        `${threshold.label}: no instrumented lines matched ${threshold.matchers.join(", ")}`;
    } else if (stats.percent < threshold.min) {
      failure =
        `${threshold.label}: ${stats.percent.toFixed(2)}% (${stats.linesHit}/${stats.linesFound}) < ${threshold.min}%`;
    }

    if (failure) {
      failures.push(failure);
    }

    return {
      ...threshold,
      stats,
      failure,
    };
  });

  const overallStats = parseCoverageByMatchers(["src/"], coverageMap, {
    excludedSources,
  });

  return {
    failures,
    overallStats,
    thresholdResults,
    uninstrumentedSources,
  };
}
