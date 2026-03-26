import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUNNER = resolve(ROOT, "scripts", "run-bun-tests.mjs");
const coverageRootDir = mkdtempSync(join(tmpdir(), "pp-coverage-"));
const coverageDirs = [
  join(coverageRootDir, "main"),
  join(coverageRootDir, "contracts-service"),
  join(coverageRootDir, "proofs-service"),
  join(coverageRootDir, "workflow-mocked"),
  join(coverageRootDir, "workflow-service"),
  join(coverageRootDir, "flow-handlers"),
];
const isolatedHomes = [
  join(coverageRootDir, "home-main"),
  join(coverageRootDir, "home-contracts-service"),
  join(coverageRootDir, "home-proofs-service"),
  join(coverageRootDir, "home-workflow-mocked"),
  join(coverageRootDir, "home-workflow-service"),
  join(coverageRootDir, "home-flow-handlers"),
];
const CONTRACTS_SERVICE_TEST = "./test/services/contracts.service.test.ts";
const PROOFS_SERVICE_TEST = "./test/services/proofs.service.test.ts";
const WORKFLOW_MOCKED_TEST = "./test/services/workflow.mocked.service.test.ts";
const WORKFLOW_SERVICE_TEST = "./test/services/workflow.service.test.ts";
const FLOW_HANDLERS_TEST = "./test/unit/flow-handlers.unit.test.ts";
const COMMAND_SURFACE_TESTS = [
  "./test/conformance/command-metadata.conformance.test.ts",
  "./test/conformance/completion-spec.conformance.test.ts",
  "./test/conformance/lazy-startup.conformance.test.ts",
  "./test/conformance/root-help-static.conformance.test.ts",
];

const thresholds = [
  { label: "services", prefix: "src/services/", min: 77 },
  { label: "workflow-engine", prefix: "src/services/workflow.ts", min: 70 },
  { label: "utils", prefix: "src/utils/", min: 84 },
  { label: "output", prefix: "src/output/", min: 85 },
  { label: "config", prefix: "src/config/", min: 95 },
  { label: "flow-command", prefix: "src/commands/flow.ts", min: 70 },
  { label: "command-shells", prefix: "src/command-shells/", min: 85 },
  { label: "program", prefix: "src/program.ts", min: 85 },
];

function parseLcovFile(filePath) {
  const records = readFileSync(filePath, "utf8").split("end_of_record\n");
  const files = new Map();

  for (const record of records) {
    const sourceMatch = record.match(/^SF:(.+)$/m);
    if (!sourceMatch) continue;

    const source = sourceMatch[1].replaceAll("\\", "/");
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

function parseCoverageByPrefix(prefix, coverageMap) {
  let linesFound = 0;
  let linesHit = 0;

  for (const [normalizedSource, lineHits] of coverageMap.entries()) {
    if (!normalizedSource.includes(prefix)) continue;
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
    }
  );
}

try {
  for (const homeDir of isolatedHomes) {
    mkdirSync(homeDir, { recursive: true });
  }

  const result = runCoverageSuite(
    [
      "./test/unit",
      "./test/services",
      ...COMMAND_SURFACE_TESTS,
      "--exclude",
      CONTRACTS_SERVICE_TEST,
      "--exclude",
      PROOFS_SERVICE_TEST,
      "--exclude",
      WORKFLOW_MOCKED_TEST,
      "--exclude",
      WORKFLOW_SERVICE_TEST,
      "--exclude",
      FLOW_HANDLERS_TEST,
    ],
    coverageDirs[0],
    {
      PRIVACY_POOLS_HOME: isolatedHomes[0],
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const isolatedContractsResult = runCoverageSuite(
    [CONTRACTS_SERVICE_TEST],
    coverageDirs[1],
    {
      PRIVACY_POOLS_HOME: isolatedHomes[1],
    },
  );

  if (isolatedContractsResult.error) {
    throw isolatedContractsResult.error;
  }

  if (isolatedContractsResult.status !== 0) {
    process.exit(isolatedContractsResult.status ?? 1);
  }

  const isolatedProofsResult = runCoverageSuite(
    [PROOFS_SERVICE_TEST],
    coverageDirs[2],
    {
      PRIVACY_POOLS_HOME: isolatedHomes[2],
    },
  );

  if (isolatedProofsResult.error) {
    throw isolatedProofsResult.error;
  }

  if (isolatedProofsResult.status !== 0) {
    process.exit(isolatedProofsResult.status ?? 1);
  }

  const isolatedWorkflowResult = runCoverageSuite(
    [WORKFLOW_MOCKED_TEST],
    coverageDirs[3],
    {
      PRIVACY_POOLS_HOME: isolatedHomes[3],
    },
  );

  if (isolatedWorkflowResult.error) {
    throw isolatedWorkflowResult.error;
  }

  if (isolatedWorkflowResult.status !== 0) {
    process.exit(isolatedWorkflowResult.status ?? 1);
  }

  const isolatedWorkflowServiceResult = runCoverageSuite(
    [WORKFLOW_SERVICE_TEST],
    coverageDirs[4],
    {
      PRIVACY_POOLS_HOME: isolatedHomes[4],
    },
  );

  if (isolatedWorkflowServiceResult.error) {
    throw isolatedWorkflowServiceResult.error;
  }

  if (isolatedWorkflowServiceResult.status !== 0) {
    process.exit(isolatedWorkflowServiceResult.status ?? 1);
  }

  const isolatedFlowHandlersResult = runCoverageSuite(
    [FLOW_HANDLERS_TEST],
    coverageDirs[5],
    {
      PRIVACY_POOLS_HOME: isolatedHomes[5],
    },
  );

  if (isolatedFlowHandlersResult.error) {
    throw isolatedFlowHandlersResult.error;
  }

  if (isolatedFlowHandlersResult.status !== 0) {
    process.exit(isolatedFlowHandlersResult.status ?? 1);
  }

  const mergedCoverage = mergeCoverageMaps(
    parseLcovFile(join(coverageDirs[0], "lcov.info")),
    parseLcovFile(join(coverageDirs[1], "lcov.info")),
    parseLcovFile(join(coverageDirs[2], "lcov.info")),
    parseLcovFile(join(coverageDirs[3], "lcov.info")),
    parseLcovFile(join(coverageDirs[4], "lcov.info")),
    parseLcovFile(join(coverageDirs[5], "lcov.info")),
  );

  const failures = [];
  for (const threshold of thresholds) {
    const stats = parseCoverageByPrefix(threshold.prefix, mergedCoverage);
    if (stats.linesFound === 0) {
      failures.push(
        `${threshold.label}: no instrumented lines matched prefix ${threshold.prefix}`,
      );
    } else if (stats.percent < threshold.min) {
      failures.push(
        `${threshold.label}: ${stats.percent.toFixed(2)}% < ${threshold.min}% (${stats.linesHit}/${stats.linesFound})`
      );
    } else {
      process.stdout.write(
        `coverage ${threshold.label}: ${stats.percent.toFixed(2)}% (${stats.linesHit}/${stats.linesFound})\n`
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write("Coverage thresholds failed:\n");
    for (const failure of failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    process.exit(1);
  }
} finally {
  rmSync(coverageRootDir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}
