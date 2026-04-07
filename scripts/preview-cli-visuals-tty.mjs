#!/usr/bin/env node

import {
  formatPreviewCaseList,
  parsePreviewArgs,
  runTtyPreviewSuite,
} from "./lib/preview-cli.mjs";

export async function main(argv = process.argv.slice(2)) {
  const { caseIds, listOnly } = parsePreviewArgs(argv);

  if (listOnly) {
    process.stdout.write(`${formatPreviewCaseList(caseIds)}\n`);
    return;
  }

  const result = await runTtyPreviewSuite({ caseIds });
  if (result.failures?.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    process.stderr.write(
      `TTY preview harness failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
