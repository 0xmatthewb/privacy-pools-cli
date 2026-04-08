#!/usr/bin/env node

import { renderPreviewFixture } from "./lib/preview-cli-fixtures.mjs";

export async function main(argv = process.argv.slice(2)) {
  const [caseId] = argv;
  if (!caseId) {
    process.stderr.write("Usage: preview-cli-render-fixture <case-id>\n");
    process.exitCode = 1;
    return;
  }

  await renderPreviewFixture(caseId);
}

if (import.meta.main) {
  await main().catch((error) => {
    process.stderr.write(
      `Preview fixture failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
