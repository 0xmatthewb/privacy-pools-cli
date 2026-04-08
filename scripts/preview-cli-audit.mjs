#!/usr/bin/env node

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREVIEW_CASES } from "./lib/preview-cli-catalog.mjs";
import {
  PREVIEW_VARIANTS,
  createPreviewCoverageReport,
  formatPreviewCaseList,
  formatPreviewCoverageReportMarkdown,
  parsePreviewArgs,
  runCapturedPreviewSuite,
  runTtyPreviewSuite,
} from "./lib/preview-cli.mjs";

const AUDIT_BATCH_IDS = [
  "onboarding",
  "discovery",
  "accounts",
  "deposit",
  "withdraw",
  "flow",
  "recovery",
  "maintenance",
];

function createCaptureWriter() {
  const chunks = [];
  return {
    write(value) {
      chunks.push(value);
    },
    read() {
      return chunks.join("");
    },
  };
}

function mergePreviewResults(results) {
  const merged = results.filter(Boolean);
  return {
    skipped: merged.every((result) => result?.skipped === true),
    plans: merged.flatMap((result) => result?.plans ?? []),
    failures: merged.flatMap((result) => result?.failures ?? []),
    executions: merged.flatMap((result) => result?.executions ?? []),
  };
}

function matchesOptionalFilters(previewCase, options) {
  if (options.caseIds?.length && !options.caseIds.includes(previewCase.id)) {
    return false;
  }
  if (
    options.journeys?.length
    && !options.journeys.some((journey) => journey === previewCase.journey)
  ) {
    return false;
  }
  if (
    options.commands?.length
    && !options.commands.some((command) => command === previewCase.commandPath)
  ) {
    return false;
  }
  if (
    options.surfaces?.length
    && !options.surfaces.some((surface) => surface === previewCase.surface)
  ) {
    return false;
  }
  return true;
}

function resolveBatchId(previewCase) {
  if (previewCase.journey === "onboarding") return "onboarding";
  if (previewCase.journey === "discovery") return "discovery";
  if (previewCase.journey === "accounts") return "accounts";
  if (previewCase.commandPath === "deposit") return "deposit";
  if (
    previewCase.commandPath === "withdraw"
    || previewCase.commandPath === "withdraw quote"
  ) {
    return "withdraw";
  }
  if (previewCase.commandPath?.startsWith("flow ")) return "flow";
  if (previewCase.commandPath === "ragequit") return "recovery";
  if (
    previewCase.commandPath === "upgrade"
    || previewCase.commandPath === "sync"
  ) {
    return "maintenance";
  }
  return "maintenance";
}

function buildBatchPlans(options) {
  const batches = new Map(
    AUDIT_BATCH_IDS.map((batchId) => [batchId, []]),
  );

  for (const previewCase of PREVIEW_CASES) {
    if (!matchesOptionalFilters(previewCase, options)) {
      continue;
    }
    batches.get(resolveBatchId(previewCase))?.push(previewCase.id);
  }

  return [...batches.entries()]
    .filter(([, caseIds]) => caseIds.length > 0)
    .map(([id, caseIds]) => ({ id, caseIds }));
}

async function runSuiteWithArtifact({
  mode,
  variantId,
  options,
  artifactDir,
  batchId,
}) {
  const capture = createCaptureWriter();
  const suiteOptions = {
    ...options,
    variants: [variantId],
    writeOut: (value) => capture.write(value),
    writeErr: (value) => capture.write(value),
    ...(mode === "tty"
      ? {
          io: {
            stdin: { isTTY: true },
            stdout: { isTTY: true },
          },
        }
      : {}),
  };
  const result = mode === "captured"
    ? await runCapturedPreviewSuite(suiteOptions)
    : await runTtyPreviewSuite(suiteOptions);
  const path = join(artifactDir, `preview-${mode}-${variantId}.txt`);
  writeFileSync(path, capture.read(), "utf8");
  return { result, path };
}

async function runBatch({
  batchId,
  caseIds,
  options,
  variantIds,
  artifactDir,
}) {
  const batchArtifactDir = join(artifactDir, batchId);
  mkdirSync(batchArtifactDir, { recursive: true });
  const capturedResults = [];
  const ttyResults = [];
  const artifactPaths = {};

  for (const variantId of variantIds) {
    const batchOptions = {
      ...options,
      caseIds,
    };

    const captured = await runSuiteWithArtifact({
      mode: "captured",
      variantId,
      options: batchOptions,
      artifactDir: batchArtifactDir,
      batchId,
    });
    capturedResults.push(captured.result);
    artifactPaths[`captured:${variantId}`] = captured.path;

    const tty = await runSuiteWithArtifact({
      mode: "tty",
      variantId,
      options: batchOptions,
      artifactDir: batchArtifactDir,
      batchId,
    });
    ttyResults.push(tty.result);
    artifactPaths[`tty:${variantId}`] = tty.path;
  }

  const report = createPreviewCoverageReport({
    capturedResult: mergePreviewResults(capturedResults),
    ttyResult: mergePreviewResults(ttyResults),
    artifactPaths,
    batchId,
  });
  const markdown = formatPreviewCoverageReportMarkdown(report);
  const markdownPath = join(batchArtifactDir, "preview-coverage-report.md");
  const jsonPath = join(batchArtifactDir, "preview-coverage-report.json");
  writeFileSync(markdownPath, markdown, "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  report.artifactPaths.reportMarkdown = markdownPath;
  report.artifactPaths.reportJson = jsonPath;

  return {
    batchId,
    report,
    capturedResult: mergePreviewResults(capturedResults),
    ttyResult: mergePreviewResults(ttyResults),
    artifactDir: batchArtifactDir,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parsePreviewArgs(argv);

  if (options.listOnly) {
    process.stdout.write(`${formatPreviewCaseList(options)}\n`);
    return;
  }

  const variantIds = options.smoke
    ? ["rich"]
    : options.variants ?? Object.keys(PREVIEW_VARIANTS);
  const artifactDir = mkdtempSync(
    join(tmpdir(), "privacy-pools-cli-preview-audit-"),
  );
  const batchPlans = buildBatchPlans(options);
  const batchResults = [];
  const capturedResults = [];
  const ttyResults = [];
  const artifactPaths = {};

  for (const batch of batchPlans) {
    const batchResult = await runBatch({
      batchId: batch.id,
      caseIds: batch.caseIds,
      options,
      variantIds,
      artifactDir,
    });
    batchResults.push({
      id: batch.id,
      caseCount: batch.caseIds.length,
      summary: batchResult.report.summary,
      artifactDir: batchResult.artifactDir,
      artifactPaths: batchResult.report.artifactPaths,
    });
    capturedResults.push(batchResult.capturedResult);
    ttyResults.push(batchResult.ttyResult);
    artifactPaths[batch.id] = batchResult.artifactDir;
  }

  const report = createPreviewCoverageReport({
    capturedResult: mergePreviewResults(capturedResults),
    ttyResult: mergePreviewResults(ttyResults),
    artifactPaths,
    batchId: "aggregate",
    batches: batchResults,
  });
  const markdown = formatPreviewCoverageReportMarkdown(report);
  const markdownPath = join(artifactDir, "preview-coverage-report.md");
  const jsonPath = join(artifactDir, "preview-coverage-report.json");
  writeFileSync(markdownPath, markdown, "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  report.artifactPaths.reportMarkdown = markdownPath;
  report.artifactPaths.reportJson = jsonPath;

  if (options.reportJson) {
    process.stdout.write(`${JSON.stringify({ ...report, artifactDir }, null, 2)}\n`);
  } else {
    process.stdout.write(`Artifacts: ${artifactDir}\n\n${markdown}`);
  }

  if (
    report.summary.failedPlans > 0 ||
    report.summary.missingStates > 0 ||
    report.summary.unexpectedObservedRoutes > 0 ||
    (report.summary.truthRequirementViolations ?? 0) > 0 ||
    (report.summary.ptyBackendFailures ?? 0) > 0 ||
    ttyResults.some((result) => result?.skipped)
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    process.stderr.write(
      `Preview audit failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
