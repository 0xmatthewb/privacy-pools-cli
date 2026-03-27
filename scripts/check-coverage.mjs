import { spawnSync } from "node:child_process";
import {
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMAND_SURFACE_TESTS,
  COVERAGE_ISOLATED_SUITES,
  COVERAGE_MAIN_EXCLUDED_TESTS,
  COVERAGE_MAIN_TEST_TARGETS,
} from "./test-suite-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");

const coverageRootDir = mkdtempSync(join(tmpdir(), "pp-coverage-"));
const keepCoverageRoot = process.env.PP_KEEP_COVERAGE_ROOT === "1";

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function stripLcovSourceSearchAndHash(source) {
  const queryIndex = source.indexOf("?");
  const hashIndex = source.indexOf("#");
  const cutIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cutIndex === undefined ? source : source.slice(0, cutIndex);
}

const EXCLUDED_SOURCES = new Set([
  normalizePath(resolve(ROOT, "src/utils/command-discovery-static.ts")),
  normalizePath(resolve(ROOT, "src/services/circuit-checksums.js")),
  normalizePath(resolve(ROOT, "src/types.ts")),
]);

const thresholds = [
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
    ],
  },
  { label: "config", min: 95, matchers: ["src/config/"] },
];

function parseLcovFile(filePath) {
  const records = readFileSync(filePath, "utf8").split("end_of_record\n");
  const files = new Map();

  for (const record of records) {
    const sourceMatch = record.match(/^SF:(.+)$/m);
    if (!sourceMatch) continue;

    const source = normalizePath(
      isAbsolute(stripLcovSourceSearchAndHash(sourceMatch[1]))
        ? stripLcovSourceSearchAndHash(sourceMatch[1])
        : resolve(ROOT, stripLcovSourceSearchAndHash(sourceMatch[1])),
    );
    const lineHits = files.get(source) ?? new Map();
    for (const line of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      const lineNumber = Number(line[1]);
      const hits = Number(line[2]);
      lineHits.set(lineNumber, Math.max(lineHits.get(lineNumber) ?? 0, hits));
    }
    files.set(source, lineHits);
  }

  return files;
}

function mergeCoverageMaps(...maps) {
  const merged = new Map();

  for (const map of maps) {
    for (const [source, lineHits] of map.entries()) {
      const target = merged.get(source) ?? new Map();
      for (const [lineNumber, hits] of lineHits.entries()) {
        target.set(lineNumber, Math.max(target.get(lineNumber) ?? 0, hits));
      }
      merged.set(source, target);
    }
  }

  return merged;
}

function serializeCoverageMapToLcov(coverageMap) {
  const records = [];
  const sources = Array.from(coverageMap.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const source of sources) {
    const lineHits = coverageMap.get(source);
    if (!lineHits) continue;

    records.push(`SF:${source}`);
    const lines = Array.from(lineHits.entries()).sort((a, b) => a[0] - b[0]);
    for (const [lineNumber, hits] of lines) {
      records.push(`DA:${lineNumber},${hits}`);
    }
    records.push("end_of_record");
  }

  return `${records.join("\n")}\n`;
}

function isExcludedSource(source) {
  return EXCLUDED_SOURCES.has(normalizePath(source));
}

function matchesAnyPrefix(source, prefixes) {
  return prefixes.some((prefix) => source.includes(prefix));
}

function parseCoverageByMatchers(matchers, coverageMap) {
  let linesFound = 0;
  let linesHit = 0;

  for (const [normalizedSource, lineHits] of coverageMap.entries()) {
    if (isExcludedSource(normalizedSource)) continue;
    if (!matchesAnyPrefix(normalizedSource, matchers)) continue;

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

function collectTopUncoveredFiles(coverageMap, limit = 12) {
  const rows = [];

  for (const [source, lineHits] of coverageMap.entries()) {
    if (isExcludedSource(source) || !source.includes("src/")) continue;

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

function collectExecutableSourceFiles(rootDir) {
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

      files.push(normalizePath(entryPath));
    }
  }

  return files
    .filter((source) => !isExcludedSource(source))
    .sort((a, b) => a.localeCompare(b));
}

function runCoverageSuite(args, coverageDir, envOverrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("PRIVACY_POOLS_") || key.startsWith("PP_")) continue;
    env[key] = value;
  }

  return spawnSync(
    "node",
    [
      RUNNER,
      ...args,
      "--timeout",
      "600000",
      "--coverage",
      "--coverage-reporter",
      "lcov",
      "--coverage-dir",
      coverageDir,
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...env,
        ...envOverrides,
      },
    },
  );
}

try {
  const coverageDirs = {
    main: join(coverageRootDir, "main"),
  };
  const isolatedHomes = {
    main: join(coverageRootDir, "home-main"),
  };

  for (const suite of COVERAGE_ISOLATED_SUITES) {
    coverageDirs[suite.label] = join(coverageRootDir, suite.label);
    isolatedHomes[suite.label] = join(coverageRootDir, `home-${suite.label}`);
  }

  for (const path of Object.values(isolatedHomes)) {
    mkdirSync(path, { recursive: true });
  }

  const mainArgs = [...COVERAGE_MAIN_TEST_TARGETS, ...COMMAND_SURFACE_TESTS];
  for (const excluded of COVERAGE_MAIN_EXCLUDED_TESTS) {
    mainArgs.push("--exclude", excluded);
  }

  const mainResult = runCoverageSuite(mainArgs, coverageDirs.main, {
    PRIVACY_POOLS_HOME: isolatedHomes.main,
  });
  if (mainResult.error) throw mainResult.error;
  if (mainResult.status !== 0) {
    process.exit(mainResult.status ?? 1);
  }

  for (const suite of COVERAGE_ISOLATED_SUITES) {
    const result = runCoverageSuite(suite.tests, coverageDirs[suite.label], {
      PRIVACY_POOLS_HOME: isolatedHomes[suite.label],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }

  const mergedCoverage = mergeCoverageMaps(
    parseLcovFile(join(coverageDirs.main, "lcov.info")),
    ...COVERAGE_ISOLATED_SUITES.map((suite) =>
      parseLcovFile(join(coverageDirs[suite.label], "lcov.info")),
    ),
  );

  if (keepCoverageRoot) {
    writeFileSync(
      join(coverageRootDir, "merged.lcov.info"),
      serializeCoverageMapToLcov(mergedCoverage),
      "utf8",
    );
    process.stdout.write(
      `coverage debug artifacts kept at ${coverageRootDir}\n`,
    );
  }

  const failures = [];
  const executableSources = collectExecutableSourceFiles(ROOT);
  const uninstrumentedSources = executableSources.filter((source) => {
    return !mergedCoverage.has(source);
  });

  if (uninstrumentedSources.length > 0) {
    failures.push(
      `${uninstrumentedSources.length} executable src file(s) were missing from LCOV instrumentation`,
    );
  }

  for (const threshold of thresholds) {
    const stats = parseCoverageByMatchers(threshold.matchers, mergedCoverage);
    if (stats.linesFound === 0) {
      failures.push(
        `${threshold.label}: no instrumented lines matched ${threshold.matchers.join(", ")}`,
      );
      continue;
    }

    const summary =
      `${stats.percent.toFixed(2)}% (${stats.linesHit}/${stats.linesFound})`;
    if (stats.percent < threshold.min) {
      failures.push(`${threshold.label}: ${summary} < ${threshold.min}%`);
    } else {
      process.stdout.write(`coverage ${threshold.label}: ${summary}\n`);
    }
  }

  const overallStats = parseCoverageByMatchers(["src/"], mergedCoverage);

  if (failures.length > 0) {
    console.error("Coverage thresholds failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error(
      `Overall executable src coverage: ${overallStats.percent.toFixed(2)}% (${overallStats.linesHit}/${overallStats.linesFound})`,
    );
    if (uninstrumentedSources.length > 0) {
      console.error("Uninstrumented executable src files:");
      for (const source of uninstrumentedSources) {
        console.error(`- ${source.replace(`${normalizePath(ROOT)}/`, "")}`);
      }
    }
    console.error("Top uncovered files by missed line count:");
    for (const row of collectTopUncoveredFiles(mergedCoverage)) {
      console.error(
        `- ${row.source.replace(`${normalizePath(ROOT)}/`, "")}: ${row.missed} missed (${row.percent.toFixed(2)}%, ${row.hit}/${row.total})`,
      );
    }
    process.exit(1);
  }
} finally {
  if (!keepCoverageRoot) {
    rmSync(coverageRootDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}
