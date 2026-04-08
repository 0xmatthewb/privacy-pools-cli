#!/usr/bin/env node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PREVIEW_VARIANTS,
  createPreviewCoverageReport,
  formatPreviewCaseList,
  formatPreviewCoverageReportMarkdown,
  parsePreviewArgs,
  runCapturedPreviewSuite,
  runTtyPreviewSuite,
} from "./lib/preview-cli.mjs";

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

async function runSuiteWithArtifact({
  mode,
  variantId,
  options,
  artifactDir,
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
  const capturedResults = [];
  const ttyResults = [];
  const artifactPaths = {};

  for (const variantId of variantIds) {
    const captured = await runSuiteWithArtifact({
      mode: "captured",
      variantId,
      options,
      artifactDir,
    });
    capturedResults.push(captured.result);
    artifactPaths[`captured:${variantId}`] = captured.path;

    const tty = await runSuiteWithArtifact({
      mode: "tty",
      variantId,
      options,
      artifactDir,
    });
    ttyResults.push(tty.result);
    artifactPaths[`tty:${variantId}`] = tty.path;
  }

  const report = createPreviewCoverageReport({
    capturedResult: mergePreviewResults(capturedResults),
    ttyResult: mergePreviewResults(ttyResults),
    artifactPaths,
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
