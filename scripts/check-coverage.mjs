import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");

const CONTRACTS_SERVICE_TEST = "./test/services/contracts.service.test.ts";
const PROOFS_SERVICE_TEST = "./test/services/proofs.service.test.ts";
const WORKFLOW_MOCKED_TEST = "./test/services/workflow.mocked.service.test.ts";
const WORKFLOW_SERVICE_TEST = "./test/services/workflow.service.test.ts";
const WORKFLOW_INTERNAL_TEST = "./test/services/workflow.internal.service.test.ts";
const ACCOUNT_SYNC_META_TEST =
  "./test/services/account-sync-meta.service.test.ts";
const FLOW_HANDLERS_TEST = "./test/unit/flow-handlers.unit.test.ts";
const ACCOUNT_HANDLER_ERRORS_TEST =
  "./test/unit/account-handler-errors.unit.test.ts";
const ACCOUNT_READONLY_HANDLERS_TEST =
  "./test/unit/account-readonly-command-handlers.unit.test.ts";
const INIT_INTERACTIVE_TEST =
  "./test/unit/init-command-interactive.unit.test.ts";
const DEPOSIT_HANDLER_TEST =
  "./test/unit/deposit-command-handler.unit.test.ts";
const WITHDRAW_HANDLER_TEST =
  "./test/unit/withdraw-command-handler.unit.test.ts";
const RAGEQUIT_HANDLER_TEST =
  "./test/unit/ragequit-command-handler.unit.test.ts";
const POOLS_HANDLER_TEST =
  "./test/unit/pools-command-handler.unit.test.ts";

const COMMAND_SURFACE_TESTS = [
  "./test/conformance/command-metadata.conformance.test.ts",
  "./test/conformance/completion-spec.conformance.test.ts",
  "./test/conformance/lazy-startup.conformance.test.ts",
  "./test/conformance/root-help-static.conformance.test.ts",
];

const MAIN_EXCLUDED_TESTS = [
  CONTRACTS_SERVICE_TEST,
  PROOFS_SERVICE_TEST,
  WORKFLOW_MOCKED_TEST,
  WORKFLOW_SERVICE_TEST,
  WORKFLOW_INTERNAL_TEST,
  ACCOUNT_SYNC_META_TEST,
  FLOW_HANDLERS_TEST,
  ACCOUNT_HANDLER_ERRORS_TEST,
  ACCOUNT_READONLY_HANDLERS_TEST,
  INIT_INTERACTIVE_TEST,
  DEPOSIT_HANDLER_TEST,
  WITHDRAW_HANDLER_TEST,
  RAGEQUIT_HANDLER_TEST,
  POOLS_HANDLER_TEST,
];

const ISOLATED_SUITES = [
  {
    label: "contracts-service",
    tests: [CONTRACTS_SERVICE_TEST],
  },
  {
    label: "proofs-service",
    tests: [PROOFS_SERVICE_TEST],
  },
  {
    label: "workflow-mocked",
    tests: [WORKFLOW_MOCKED_TEST],
  },
  {
    label: "workflow-service",
    tests: [WORKFLOW_SERVICE_TEST],
  },
  {
    label: "workflow-internal",
    tests: [WORKFLOW_INTERNAL_TEST],
  },
  {
    label: "account-sync-meta",
    tests: [ACCOUNT_SYNC_META_TEST],
  },
  {
    label: "flow-handlers",
    tests: [FLOW_HANDLERS_TEST],
  },
  {
    label: "account-handler-errors",
    tests: [ACCOUNT_HANDLER_ERRORS_TEST],
  },
  {
    label: "account-readonly-handlers",
    tests: [ACCOUNT_READONLY_HANDLERS_TEST],
  },
  {
    label: "init-interactive",
    tests: [INIT_INTERACTIVE_TEST],
  },
  {
    label: "deposit-handler",
    tests: [DEPOSIT_HANDLER_TEST],
  },
  {
    label: "withdraw-handler",
    tests: [WITHDRAW_HANDLER_TEST],
  },
  {
    label: "ragequit-handler",
    tests: [RAGEQUIT_HANDLER_TEST],
  },
  {
    label: "pools-handler",
    tests: [POOLS_HANDLER_TEST],
  },
];

const coverageRootDir = mkdtempSync(join(tmpdir(), "pp-coverage-"));
const keepCoverageRoot = process.env.PP_KEEP_COVERAGE_ROOT === "1";

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

const EXCLUDED_SOURCES = new Set([
  normalizePath(resolve(ROOT, "src/utils/command-discovery-static.ts")),
  normalizePath(resolve(ROOT, "src/services/circuit-checksums.js")),
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

    const source = normalizePath(sourceMatch[1]);
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

  for (const suite of ISOLATED_SUITES) {
    coverageDirs[suite.label] = join(coverageRootDir, suite.label);
    isolatedHomes[suite.label] = join(coverageRootDir, `home-${suite.label}`);
  }

  for (const path of Object.values(isolatedHomes)) {
    mkdirSync(path, { recursive: true });
  }

  const mainArgs = [
    "./test/unit",
    "./test/services",
    ...COMMAND_SURFACE_TESTS,
  ];
  for (const excluded of MAIN_EXCLUDED_TESTS) {
    mainArgs.push("--exclude", excluded);
  }

  const mainResult = runCoverageSuite(mainArgs, coverageDirs.main, {
    PRIVACY_POOLS_HOME: isolatedHomes.main,
  });
  if (mainResult.error) throw mainResult.error;
  if (mainResult.status !== 0) {
    process.exit(mainResult.status ?? 1);
  }

  for (const suite of ISOLATED_SUITES) {
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
    ...ISOLATED_SUITES.map((suite) =>
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
