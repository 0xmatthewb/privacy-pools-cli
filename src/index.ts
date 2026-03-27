#!/usr/bin/env node

import { createCliPackageInfoResolver } from "./package-info.js";
import { runLauncher } from "./launcher.js";

await runLauncher(
  createCliPackageInfoResolver(import.meta.url),
  process.argv.slice(2),
);
