#!/usr/bin/env node

import { EXIT_CODES } from "./utils/errors.js";
import { printJsonError } from "./utils/json.js";
import { parseRootArgv } from "./utils/root-argv.js";
import { createCliPackageInfoResolver } from "./package-info.js";
import { runLauncher } from "./launcher.js";

function isBunMainInvocation(): boolean {
  return Boolean(
    process.versions.bun &&
      (import.meta as ImportMeta & { main?: boolean }).main,
  );
}

function emitUnsupportedBunRuntime(argv: string[]): void {
  const parsed = parseRootArgv(argv);
  const message =
    "Privacy Pools CLI supports Node.js only. Bun is not a supported runtime.";
  const hint =
    "Re-run with Node.js via `npm run dev -- <command>` from source, or install/update with `npm i -g privacy-pools-cli`.";

  if (parsed.isStructuredOutputMode) {
    printJsonError({
      code: "UNSUPPORTED_RUNTIME",
      category: "INPUT",
      message,
      hint,
      retryable: false,
    });
  } else {
    process.stderr.write(`${message}\n${hint}\n`);
  }

  process.exitCode = EXIT_CODES.INPUT;
}

const argv = process.argv.slice(2);

if (isBunMainInvocation()) {
  emitUnsupportedBunRuntime(argv);
} else {
  await runLauncher(
    createCliPackageInfoResolver(import.meta.url),
    argv,
  );
}
