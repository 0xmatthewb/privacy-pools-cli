#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES } from "./utils/errors.js";
import { printJsonError } from "./utils/json.js";
import { parseRootArgv } from "./utils/root-argv.js";
import { createCliPackageInfoResolver } from "./package-info.js";
import { runLauncher } from "./launcher.js";

function realPathOrResolved(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    return resolve(targetPath);
  }
}

function currentEntrypointPath(importMetaUrl: string): string {
  return realPathOrResolved(fileURLToPath(importMetaUrl));
}

function argvEntrypointPath(argv: string[]): string | null {
  const entry = argv[1]?.trim();
  if (!entry) {
    return null;
  }

  return realPathOrResolved(resolve(process.cwd(), entry));
}

function isDirectCliEntrypoint(
  importMetaUrl: string,
  argv: string[],
): boolean {
  const importMeta = import.meta as ImportMeta & { main?: boolean };
  if (importMeta.main) {
    return true;
  }

  const entryPath = argvEntrypointPath(argv);
  if (!entryPath) {
    return false;
  }

  return entryPath === currentEntrypointPath(importMetaUrl);
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

export async function runCliEntrypoint(
  entryArgv: string[] = process.argv.slice(2),
): Promise<void> {
  await runLauncher(
    createCliPackageInfoResolver(import.meta.url),
    entryArgv,
  );
}

const argv = process.argv.slice(2);

if (isDirectCliEntrypoint(import.meta.url, process.argv)) {
  if (process.versions.bun) {
    emitUnsupportedBunRuntime(argv);
  } else {
    await runCliEntrypoint(argv);
  }
}
