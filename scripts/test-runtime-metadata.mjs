import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEST_RUNTIME_METADATA_PATH = resolve(
  __dirname,
  "test-runtime-metadata.json",
);

let runtimeMetadataCache = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function loadRuntimeMetadata({
  filePath = TEST_RUNTIME_METADATA_PATH,
  resetCache = false,
} = {}) {
  if (!resetCache && runtimeMetadataCache?.filePath === filePath) {
    return runtimeMetadataCache.value;
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  const value = {
    version: Number(parsed.version) || 1,
    suiteBudgetsMs: { ...(parsed.suiteBudgetsMs ?? {}) },
    profileStepBudgetsMs: { ...(parsed.profileStepBudgetsMs ?? {}) },
    suiteTimingBaselinesMs: { ...(parsed.suiteTimingBaselinesMs ?? {}) },
    profileTimingBaselinesMs: { ...(parsed.profileTimingBaselinesMs ?? {}) },
    tagTimingBaselinesMs: { ...(parsed.tagTimingBaselinesMs ?? {}) },
  };

  runtimeMetadataCache = { filePath, value };
  return value;
}

export function saveRuntimeMetadata(
  metadata,
  { filePath = TEST_RUNTIME_METADATA_PATH } = {},
) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  runtimeMetadataCache = { filePath, value: cloneJson(metadata) };
}

function pickNumber(mapping, key) {
  const value = mapping?.[key];
  return Number.isInteger(value) ? value : null;
}

export function getSuiteRuntimeBudget(label, options = {}) {
  return pickNumber(loadRuntimeMetadata(options).suiteBudgetsMs, label);
}

export function getProfileStepRuntimeBudget(command, args, options = {}) {
  return pickNumber(
    loadRuntimeMetadata(options).profileStepBudgetsMs,
    `${command} ${args.join(" ")}`,
  );
}

export function getSuiteRuntimeBaseline(label, options = {}) {
  return pickNumber(loadRuntimeMetadata(options).suiteTimingBaselinesMs, label);
}

export function getProfileStepRuntimeBaseline(label, options = {}) {
  return pickNumber(loadRuntimeMetadata(options).profileTimingBaselinesMs, label);
}

export function getTagRuntimeBaseline(tag, options = {}) {
  return pickNumber(loadRuntimeMetadata(options).tagTimingBaselinesMs, tag);
}

export function formatRuntimeDuration(durationMs) {
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)}s`;
}

export function formatRuntimeBudget(budgetMs) {
  return budgetMs === null || budgetMs === undefined
    ? "n/a"
    : formatRuntimeDuration(budgetMs);
}

function buildResultLabel(result) {
  const labels = [];
  if (Number.isInteger(result.budgetMs)) {
    labels.push(`budget ${formatRuntimeBudget(result.budgetMs)}`);
  }
  if (Number.isInteger(result.baselineMs)) {
    labels.push(`baseline ${formatRuntimeBudget(result.baselineMs)}`);
  }
  if (result.budgetExceeded) {
    labels.push("over budget");
  }
  return labels.length === 0 ? "" : ` (${labels.join(", ")})`;
}

export function summarizeRuntimeByTag(results) {
  const summaries = new Map();

  for (const result of results) {
    const tags = Array.isArray(result.tags)
      ? [...new Set(result.tags.filter(Boolean))]
      : [];

    for (const tag of tags) {
      const current = summaries.get(tag) ?? {
        tag,
        suiteCount: 0,
        durationMs: 0,
        maxDurationMs: 0,
        budgetFailureCount: 0,
      };
      current.suiteCount += 1;
      current.durationMs += result.durationMs;
      current.maxDurationMs = Math.max(current.maxDurationMs, result.durationMs);
      if (result.budgetExceeded) {
        current.budgetFailureCount += 1;
      }
      summaries.set(tag, current);
    }
  }

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      averageDurationMs:
        summary.suiteCount === 0
          ? 0
          : Math.round(summary.durationMs / summary.suiteCount),
    }))
    .sort((left, right) => {
      if (right.durationMs !== left.durationMs) {
        return right.durationMs - left.durationMs;
      }
      return left.tag.localeCompare(right.tag);
    });
}

export function summarizeRuntimeByFile(results) {
  const summaries = new Map();

  for (const result of results) {
    const tests = Array.isArray(result.tests)
      ? [...new Set(result.tests.filter(Boolean))]
      : [];
    if (tests.length === 0) {
      continue;
    }

    const perFileDuration = Math.max(
      1,
      Math.round(Number(result.durationMs) / tests.length),
    );

    for (const path of tests) {
      const current = summaries.get(path) ?? {
        path,
        totalDurationMs: 0,
        sampleCount: 0,
      };
      current.totalDurationMs += perFileDuration;
      current.sampleCount += 1;
      summaries.set(path, current);
    }
  }

  return [...summaries.values()]
    .map((summary) => ({
      path: summary.path,
      sampleCount: summary.sampleCount,
      estimatedDurationMs: Math.max(
        1,
        Math.round(summary.totalDurationMs / summary.sampleCount),
      ),
    }))
    .sort((left, right) => {
      if (right.estimatedDurationMs !== left.estimatedDurationMs) {
        return right.estimatedDurationMs - left.estimatedDurationMs;
      }
      return left.path.localeCompare(right.path);
    });
}

export function reportRuntimeSummary(
  heading,
  results,
  stream = process.stdout,
  slowCount = 10,
  options = {},
) {
  if (!Array.isArray(results) || results.length === 0) {
    return;
  }

  const sorted = [...results].sort((left, right) =>
    right.durationMs - left.durationMs
  );

  stream.write(`\n[perf] ${heading}\n`);
  for (const result of sorted.slice(0, slowCount)) {
    stream.write(
      `[perf] ${result.label}: ${formatRuntimeDuration(result.durationMs)}${buildResultLabel(result)}\n`,
    );
  }

  if (options.includeTagSummary === false) {
    return;
  }

  const tagSummaries = summarizeRuntimeByTag(results);
  if (tagSummaries.length === 0) {
    stream.write("[perf] slowest tag totals unavailable\n");
  } else {
    stream.write("[perf] slowest tag totals\n");
    for (const summary of tagSummaries.slice(0, slowCount)) {
      const baseline = getTagRuntimeBaseline(summary.tag);
      const baselineLabel = Number.isInteger(baseline)
        ? ` (baseline ${formatRuntimeBudget(baseline)})`
        : "";
      const budgetLabel = summary.budgetFailureCount > 0
        ? ` ${summary.budgetFailureCount} budget overrun${summary.budgetFailureCount === 1 ? "" : "s"}`
        : "";
      stream.write(
        `[perf] tag:${summary.tag}: ${formatRuntimeDuration(summary.durationMs)} across ${summary.suiteCount} suite(s), avg ${formatRuntimeDuration(summary.averageDurationMs)}, max ${formatRuntimeDuration(summary.maxDurationMs)}${baselineLabel}${budgetLabel}\n`,
      );
    }
  }

  if (options.includeFileSummary === false) {
    return;
  }

  const fileSummaries = summarizeRuntimeByFile(results);
  if (fileSummaries.length === 0) {
    stream.write("[perf] slowest file totals unavailable\n");
    return;
  }

  stream.write("[perf] slowest file totals\n");
  for (const summary of fileSummaries.slice(0, slowCount)) {
    stream.write(
      `[perf] file:${summary.path}: ${formatRuntimeDuration(summary.estimatedDurationMs)} across ${summary.sampleCount} sample(s)\n`,
    );
  }
}

export function collectRuntimeBudgetFailures(results) {
  return results.filter((result) => result.budgetExceeded);
}

export function buildRuntimeReport({
  kind,
  heading,
  results,
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    kind,
    heading,
    generatedAt,
    tagSummaries: summarizeRuntimeByTag(results ?? []),
    fileSummaries: summarizeRuntimeByFile(results ?? []),
    results: (results ?? []).map((result) => ({
      label: result.label,
      canonicalLabel: result.canonicalLabel ?? result.label,
      durationMs: result.durationMs,
      budgetMs: result.budgetMs ?? null,
      baselineMs: result.baselineMs ?? null,
      budgetExceeded: Boolean(result.budgetExceeded),
      tags: [...(result.tags ?? [])],
      tests: [...(result.tests ?? [])],
    })),
  };
}

export function writeRuntimeReport(
  report,
  outputPath = process.env.PP_TEST_RUNTIME_REPORT_PATH,
) {
  if (!outputPath) {
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function writeRuntimeReportIfRequested(report, options = {}) {
  writeRuntimeReport(
    report,
    options.outputPath ?? process.env.PP_TEST_RUNTIME_REPORT_PATH,
  );
}

function rollingAverage(previous, nextValue) {
  if (!Number.isInteger(previous)) {
    return nextValue;
  }
  return Math.round(previous * 0.7 + nextValue * 0.3);
}

function mergeDurationBaselines(target, updates) {
  for (const [key, durationMs] of Object.entries(updates)) {
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      continue;
    }
    target[key] = rollingAverage(target[key], durationMs);
  }
}

export function mergeRuntimeReportsIntoMetadata(metadata, reports) {
  const next = cloneJson(metadata);
  const suiteUpdates = {};
  const profileUpdates = {};
  const tagUpdates = {};

  for (const report of reports) {
    for (const result of report.results ?? []) {
      const canonicalLabel = result.canonicalLabel ?? result.label;
      if (report.kind === "profile") {
        profileUpdates[canonicalLabel] = Number(result.durationMs);
      } else {
        suiteUpdates[canonicalLabel] = Number(result.durationMs);
      }
    }

    for (const tagSummary of report.tagSummaries ?? []) {
      tagUpdates[tagSummary.tag] = Number(tagSummary.durationMs);
    }
  }

  mergeDurationBaselines(next.suiteTimingBaselinesMs, suiteUpdates);
  mergeDurationBaselines(next.profileTimingBaselinesMs, profileUpdates);
  mergeDurationBaselines(next.tagTimingBaselinesMs, tagUpdates);

  return next;
}
