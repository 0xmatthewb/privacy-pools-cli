#!/usr/bin/env node

import { readCliPackageInfo } from "./package-info.js";
import { runLauncher } from "./launcher.js";
import { installConsoleGuard } from "./utils/console-guard.js";

// Permanently suppress console.* so deferred SDK callbacks (e.g. RPC retry
// logs) never leak raw `[Data::WARN]` lines into human output. Safe because
// the CLI routes all its own output through process.stderr/stdout.write.
installConsoleGuard();

await runLauncher(readCliPackageInfo(import.meta.url), process.argv.slice(2));
