#!/usr/bin/env node

import { CLIError, printError } from "../../utils/errors.js";
import { parseRootArgv } from "../../utils/root-argv.js";
import { runWorkerFromEnv } from "./worker.js";
import { readWorkerRequestFromEnv, WORKER_REQUEST_ENV } from "./request.js";

function resolveStructuredWorkerMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const request = readWorkerRequestFromEnv(env);
    return parseRootArgv(request.argv).isStructuredOutputMode;
  } catch {
    return false;
  }
}

function classifyWorkerBootstrapError(error: unknown): CLIError {
  if (error instanceof CLIError) return error;

  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes(WORKER_REQUEST_ENV) ||
    message.toLowerCase().includes("worker request")
  ) {
    return new CLIError(
      "The JS runtime worker request is missing or invalid.",
      "INPUT",
      `Re-run the CLI through the privacy-pools launcher. If you set ${WORKER_REQUEST_ENV} manually, clear it and retry.`,
    );
  }

  return new CLIError(
    "The JS runtime worker failed before command execution started.",
    "UNKNOWN",
    "Re-run the command. If it persists, verify the installed CLI and native package versions match.",
  );
}

try {
  await runWorkerFromEnv();
} catch (error) {
  printError(classifyWorkerBootstrapError(error), resolveStructuredWorkerMode());
}
