import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_LEVELS = [1, 2, 3, 4];
const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_MS = 600_000;
const SAMPLE_TESTS = [
  "./test/services/workflow.helpers.service.test.ts",
  "./test/services/relayer.helpers.service.test.ts",
  "./test/unit/withdraw-command.helpers.unit.test.ts",
  "./test/unit/ragequit-command-handler.entry-submit.unit.test.ts",
];

function parseArgs(argv) {
  const parsed = {
    levels: DEFAULT_LEVELS,
    runs: DEFAULT_RUNS,
    subset: SAMPLE_TESTS.length,
    keep: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--levels") {
      parsed.levels = parseIntegerList(argv[++index], "--levels");
      continue;
    }
    if (token === "--runs") {
      parsed.runs = parsePositiveInteger(argv[++index], "--runs");
      continue;
    }
    if (token === "--subset") {
      parsed.subset = parsePositiveInteger(argv[++index], "--subset");
      continue;
    }
    if (token === "--timeout-ms") {
      parsed.timeoutMs = parsePositiveInteger(argv[++index], "--timeout-ms");
      continue;
    }
    if (token === "--keep") {
      parsed.keep = true;
      continue;
    }
    throw new Error(`Unknown option ${token}`);
  }

  return parsed;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function parseIntegerList(value, flag) {
  const parsed = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parsePositiveInteger(entry, flag));
  if (parsed.length === 0) {
    throw new Error(`${flag} requires at least one value`);
  }
  return [...new Set(parsed)].sort((left, right) => left - right);
}

function resolveBunVersion() {
  const result = spawnSync("bun", ["--version"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function chunkTests(tests, concurrency) {
  const chunkCount = Math.min(Math.max(1, concurrency), tests.length);
  const chunks = Array.from({ length: chunkCount }, () => []);
  tests.forEach((testPath, index) => {
    chunks[index % chunkCount].push(testPath);
  });
  return chunks.filter((chunk) => chunk.length > 0);
}

function parseLcov(content) {
  const coverage = new Map();

  for (const record of content.split("end_of_record\n")) {
    const source = record.match(/^SF:(.+)$/m)?.[1];
    if (!source) continue;

    const lines = coverage.get(source) ?? new Map();
    for (const match of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      const lineNumber = Number(match[1]);
      const hits = Number(match[2]);
      lines.set(lineNumber, Math.max(lines.get(lineNumber) ?? 0, hits));
    }
    coverage.set(source, lines);
  }

  return coverage;
}

function mergeCoverageMaps(contents) {
  const merged = new Map();

  for (const content of contents) {
    for (const [source, lines] of parseLcov(content)) {
      const target = merged.get(source) ?? new Map();
      for (const [lineNumber, hits] of lines) {
        target.set(lineNumber, Math.max(target.get(lineNumber) ?? 0, hits));
      }
      merged.set(source, target);
    }
  }

  return merged;
}

function serializeCoverageMap(coverage) {
  const records = [];
  for (const source of [...coverage.keys()].sort((left, right) =>
    left.localeCompare(right)
  )) {
    records.push(`SF:${source}`);
    const lines = coverage.get(source) ?? new Map();
    for (const [lineNumber, hits] of [...lines.entries()].sort((left, right) =>
      left[0] - right[0]
    )) {
      records.push(`DA:${lineNumber},${hits}`);
    }
    records.push("end_of_record");
  }
  return `${records.join("\n")}\n`;
}

async function runBunCoverage({ tests, coverageDir, timeoutMs, runId }) {
  mkdirSync(coverageDir, { recursive: true });
  const startedAt = Date.now();
  const child = spawn(
    "bun",
    [
      "test",
      ...tests,
      "--coverage",
      "--coverage-reporter",
      "lcov",
      "--coverage-dir",
      coverageDir,
      "--timeout",
      String(timeoutMs),
    ],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildTestRunnerEnv({
        PP_TEST_ALLOW_DIRECT: "1",
        PP_TEST_RUN_ID: runId,
      }),
    },
  );

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout?.resume();

  return await new Promise((resolveRun, rejectRun) => {
    child.once("error", rejectRun);
    child.once("close", (status, signal) => {
      const lcovPath = join(coverageDir, "lcov.info");
      const lcov = existsSync(lcovPath) ? readFileSync(lcovPath, "utf8") : "";
      resolveRun({
        status,
        signal,
        durationMs: Date.now() - startedAt,
        lcov,
        stderr,
      });
    });
  });
}

async function runLevel({ level, runNumber, tests, rootDir, timeoutMs }) {
  const chunks = chunkTests(tests, level);
  const runId = `coverage-bench-${process.pid}-${Date.now()}-${level}-${runNumber}`;
  const startedAt = Date.now();
  const results = await Promise.all(
    chunks.map((chunk, index) =>
      runBunCoverage({
        tests: chunk,
        coverageDir: join(rootDir, `level-${level}`, `run-${runNumber}`, `chunk-${index + 1}`),
        timeoutMs,
        runId: `${runId}-${index + 1}`,
      })
    ),
  );
  const failed = results.find((result) =>
    result.signal || result.status !== 0 || result.lcov.length === 0
  );
  const lcov = serializeCoverageMap(
    mergeCoverageMaps(results.map((result) => result.lcov)),
  );
  const sha = createHash("sha256").update(lcov).digest("hex");

  return {
    level,
    run: runNumber,
    chunks: chunks.length,
    status: failed ? "fail" : "ok",
    wallMs: Date.now() - startedAt,
    childMs: results.reduce((total, result) => total + result.durationMs, 0),
    lcovLines: lcov.length === 0 ? 0 : lcov.split("\n").length,
    lcovSha: sha,
    stderr: results.map((result) => result.stderr).join("\n").trim(),
  };
}

function summarize(results) {
  const byLevel = new Map();
  for (const result of results) {
    const bucket = byLevel.get(result.level) ?? [];
    bucket.push(result);
    byLevel.set(result.level, bucket);
  }

  const baselineLines = byLevel.get(1)?.[0]?.lcovLines ?? null;
  return [...byLevel.entries()].map(([level, entries]) => {
    const shas = new Set(entries.map((entry) => entry.lcovSha));
    const lineCounts = new Set(entries.map((entry) => entry.lcovLines));
    return {
      level,
      deterministic: shas.size === 1,
      complete:
        baselineLines === null
        || [...lineCounts].every((count) => count === baselineLines),
      lineCounts: [...lineCounts].sort((left, right) => left - right),
      shas: [...shas].sort(),
    };
  });
}

const args = parseArgs(process.argv);
const tests = SAMPLE_TESTS.slice(0, Math.min(args.subset, SAMPLE_TESTS.length));
const rootDir = mkdtempSync(join(tmpdir(), "pp-coverage-bench-"));
const results = [];

try {
  process.stdout.write(
    `coverage concurrency benchmark: Bun ${resolveBunVersion()}, ${tests.length} test file(s), levels ${args.levels.join(",")}, ${args.runs} run(s)\n`,
  );
  for (const testPath of tests) {
    process.stdout.write(`- ${testPath}\n`);
  }
  process.stdout.write("\nlevel run chunks status wall_ms child_ms lcov_lines lcov_sha\n");

  for (const level of args.levels) {
    for (let runNumber = 1; runNumber <= args.runs; runNumber += 1) {
      const result = await runLevel({
        level,
        runNumber,
        tests,
        rootDir,
        timeoutMs: args.timeoutMs,
      });
      results.push(result);
      process.stdout.write(
        [
          result.level,
          result.run,
          result.chunks,
          result.status,
          result.wallMs,
          result.childMs,
          result.lcovLines,
          result.lcovSha,
        ].join(" ") + "\n",
      );
      if (result.status !== "ok" && result.stderr) {
        process.stderr.write(`${result.stderr}\n`);
      }
    }
  }

  process.stdout.write("\nsummary\n");
  for (const entry of summarize(results)) {
    process.stdout.write(
      `level ${entry.level}: deterministic=${entry.deterministic ? "yes" : "no"} complete=${entry.complete ? "yes" : "no"} lines=${entry.lineCounts.join(",")}\n`,
    );
  }

  if (results.some((result) => result.status !== "ok")) {
    process.exitCode = 1;
  }
} finally {
  if (args.keep) {
    process.stdout.write(`coverage benchmark artifacts kept at ${rootDir}\n`);
  } else {
    rmSync(rootDir, { recursive: true, force: true });
  }
}
