#!/usr/bin/env node

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { installConsoleGuard } from "./utils/console-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as {
  version: string;
  repository?: unknown;
};

// Permanently suppress console.* so deferred SDK callbacks (e.g. RPC retry
// logs) never leak raw `[Data::WARN]` lines into human output. Safe because
// the CLI routes all its own output through process.stderr/stdout.write.
installConsoleGuard();

const argv = process.argv.slice(2);

// chalk reads NO_COLOR lazily, so setting it before the main CLI module loads
// preserves the current behavior for both the fast path and the full CLI path.
if (argv.includes("--no-color")) {
  process.env.NO_COLOR = "1";
}

function hasShortFlag(args: string[], flag: string): boolean {
  for (const token of args) {
    if (!token.startsWith("-") || token.startsWith("--")) continue;
    if (token === `-${flag}`) return true;
    if (/^-[A-Za-z]+$/.test(token) && token.includes(flag)) return true;
  }
  return false;
}

const ROOT_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "--chain",
  "--format",
  "-r",
  "--rpc-url",
  "--timeout",
]);

function firstNonOptionToken(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("-")) return token;
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) i++;
  }
  return undefined;
}

const firstCommandToken = firstNonOptionToken(argv);
const formatFlagValue = (() => {
  const idx = argv.indexOf("--format");
  return idx !== -1 && idx + 1 < argv.length
    ? argv[idx + 1].toLowerCase()
    : null;
})();
const isJson =
  argv.includes("--json") ||
  hasShortFlag(argv, "j") ||
  formatFlagValue === "json";
const isCsvMode = formatFlagValue === "csv";
const isAgent = argv.includes("--agent");
const isUnsigned = argv.includes("--unsigned");
const isMachineMode = isJson || isCsvMode || isUnsigned || isAgent;
const isVersionLike = argv.includes("--version") || hasShortFlag(argv, "V");

async function writeVersionOutput(): Promise<void> {
  if (isMachineMode) {
    const { printJsonSuccess } = await import("./utils/json.js");
    printJsonSuccess({
      mode: "version",
      version: pkg.version,
    });
    return;
  }

  process.stdout.write(`${pkg.version}\n`);
}

if (isVersionLike && firstCommandToken === undefined) {
  await writeVersionOutput();
  process.exit(0);
}

const { runCli } = await import("./cli-main.js");
await runCli(pkg, argv);
