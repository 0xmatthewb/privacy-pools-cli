#!/usr/bin/env node

import { runWorkerFromEnv } from "./worker.js";

try {
  await runWorkerFromEnv();
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unknown worker bootstrap error.";
  process.stderr.write(`privacy-pools worker error: ${message}\n`);
  process.exit(1);
}
