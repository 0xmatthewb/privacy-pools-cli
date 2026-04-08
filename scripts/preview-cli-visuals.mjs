#!/usr/bin/env node

import {
  createPreviewCoverageReport,
  formatPreviewCaseList,
  formatPreviewCoverageReportMarkdown,
  parsePreviewArgs,
  runCapturedPreviewSuite,
} from "./lib/preview-cli.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = parsePreviewArgs(argv);

  if (options.listOnly) {
    process.stdout.write(`${formatPreviewCaseList(options)}\n`);
    return;
  }

  const result = await runCapturedPreviewSuite(options);
  if (options.reportJson) {
    const report = createPreviewCoverageReport({
      capturedResult: result,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!result.dryRun) {
    const report = createPreviewCoverageReport({
      capturedResult: result,
    });
    process.stdout.write(`\n${formatPreviewCoverageReportMarkdown(report)}`);
  }
  if (result.failures?.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    process.stderr.write(
      `Preview harness failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
