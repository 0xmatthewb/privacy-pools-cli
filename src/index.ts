#!/usr/bin/env node

import { Command } from "commander";
import { config as loadEnv } from "dotenv";
import chalk from "chalk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
import { printBanner } from "./utils/banner.js";
import { styleCommanderHelp, welcomeScreen } from "./utils/help.js";
import { checkForUpdateInBackground, getUpdateNotice } from "./utils/update-check.js";
import { CLIError, EXIT_CODES, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
import { createRootProgram } from "./program.js";
import { installSdkConsoleGuard } from "./services/account.js";
import { dangerTone } from "./utils/theme.js";

// Permanently suppress console.* so deferred SDK callbacks (e.g. RPC retry
// logs) never leak raw `[Data::WARN]` lines into human output.  Safe because
// the CLI routes all its own output through process.stderr/stdout.write.
installSdkConsoleGuard();

// Load .env from the config directory (~/.privacy-pools/.env), not CWD.
// Loading from CWD would let a malicious .env in a cloned repo silently
// redirect RPC/ASP/relayer endpoints or swap the signer key.
const configHome =
  process.env.PRIVACY_POOLS_HOME?.trim() ||
  process.env.PRIVACY_POOLS_CONFIG_DIR?.trim() ||
  join(homedir(), ".privacy-pools");
loadEnv({ path: join(configHome, ".env") });

const argv = process.argv.slice(2);

// --no-color: set NO_COLOR before any chalk output is produced.
// chalk v5 reads this env var lazily, so setting it here is sufficient.
if (argv.includes("--no-color")) {
  process.env.NO_COLOR = "1";
}

// Fire-and-forget update check — caches result for 24h, never blocks.
checkForUpdateInBackground();

function normalizeRepositoryUrl(repository: unknown): string | null {
  const raw = typeof repository === "string"
    ? repository
    : typeof repository === "object" &&
        repository !== null &&
        "url" in repository &&
        typeof (repository as { url?: unknown }).url === "string"
      ? (repository as { url: string }).url
      : null;

  if (!raw) return null;

  return raw
    .replace(/^git\+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/\.git$/, "");
}

function hasShortFlag(args: string[], flag: string): boolean {
  for (const token of args) {
    if (!token.startsWith("-") || token.startsWith("--")) continue;
    if (token === `-${flag}`) return true;
    // Support bundled short flags, e.g. -jy or -qV
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

const WELCOME_BOOLEAN_FLAGS = new Set([
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "-y",
  "--yes",
  "--no-banner",
  "--no-color",
]);

function isWelcomeShortFlagBundle(token: string): boolean {
  if (!/^-[A-Za-z]+$/.test(token) || token.startsWith("--")) return false;
  return token
    .slice(1)
    .split("")
    .every((flag) => flag === "q" || flag === "v" || flag === "y");
}

function firstNonOptionToken(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("-")) return token;
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) i++;
  }
  return undefined;
}

function isWelcomeFlagOnlyInvocation(args: string[]): boolean {
  if (args.length === 0) return true;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) {
      if (i + 1 >= args.length) return false;
      i++;
      continue;
    }
    if (WELCOME_BOOLEAN_FLAGS.has(token) || isWelcomeShortFlagBundle(token)) {
      continue;
    }
    return false;
  }
  return true;
}

const firstCommandToken = firstNonOptionToken(argv);
const formatFlagValue = (() => {
  const idx = argv.indexOf("--format");
  return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1].toLowerCase() : null;
})();
const isJson = argv.includes("--json") || hasShortFlag(argv, "j") || formatFlagValue === "json";
const isCsvMode = formatFlagValue === "csv";
const isAgent = argv.includes("--agent");
const isUnsigned = argv.includes("--unsigned");
const isMachineMode = isJson || isCsvMode || isUnsigned || isAgent;
const isHelpLike = argv.includes("--help") || hasShortFlag(argv, "h") || firstCommandToken === "help";
const isVersionLike = argv.includes("--version") || hasShortFlag(argv, "V");
const captureMachineOutput = isMachineMode && (isHelpLike || isVersionLike);
const suppressBanner = argv.includes("--no-banner");
const isQuiet = argv.includes("--quiet") || hasShortFlag(argv, "q");
const isWelcome = isWelcomeFlagOnlyInvocation(argv) && !isMachineMode;
let machineCapturedOut = "";

const program = createRootProgram(pkg.version);

if (!isMachineMode) {
  program.showSuggestionAfterError(true);
  program.showHelpAfterError(chalk.dim("\nUse --help to see usage and examples."));
} else {
  program.showSuggestionAfterError(false);
  program.showHelpAfterError(false);
}

program.configureOutput({
  writeOut: (str: string) => {
    if (captureMachineOutput) {
      machineCapturedOut += str;
      return;
    }
    if (isWelcome) return; // Suppress Commander's default help; we show our own welcome screen
    const styled = styleCommanderHelp(str);
    process.stdout.write(styled);
  },
  writeErr: (str: string) => {
    if (isWelcome) return; // Suppress Commander's stderr help for welcome screen
    if (!isMachineMode) process.stderr.write(str);
  },
  outputError: (str, write) => {
    if (!isMachineMode) {
      write(dangerTone(str));
    }
  },
});
if (isMachineMode) {
  const applyMachineMode = (cmd: Command): void => {
    cmd.showSuggestionAfterError(false);
    cmd.showHelpAfterError(false);
    cmd.configureOutput({
      writeOut: (str: string) => {
        if (captureMachineOutput) {
          machineCapturedOut += str;
          return;
        }
        const styled = styleCommanderHelp(str);
        process.stdout.write(styled);
      },
      writeErr: () => {},
      outputError: () => {},
    });
    cmd.exitOverride();

    for (const sub of cmd.commands) {
      applyMachineMode(sub);
    }
  };

  applyMachineMode(program);
}

function mapCommanderError(error: unknown): CLIError | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof (error as { code: unknown }).code !== "string"
  ) {
    return null;
  }

  const code = (error as { code: string }).code;
  const rawMessage = (error as { message?: unknown }).message;
  const message = typeof rawMessage === "string" ? rawMessage : "Invalid command input.";

  if (code.startsWith("commander.")) {
    const normalized = message.replace(/^error:\s*/i, "").trim();
    return new CLIError(
      normalized || "Invalid command input.",
      "INPUT",
      "Use --help to see usage and examples."
    );
  }

  return null;
}

(async () => {
  try {
    await program.parseAsync();
    if (
      isMachineMode &&
      !isHelpLike &&
      !isVersionLike &&
      firstCommandToken === undefined
    ) {
      printJsonSuccess({
        mode: "help",
        help: program.helpInformation().trimEnd(),
      });
    }
  } catch (err) {
    // commander.* help/version under exitOverride
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      ((err as { code?: string }).code === "commander.help" ||
        (err as { code?: string }).code === "commander.helpDisplayed" ||
        (err as { code?: string }).code === "commander.version")
    ) {
      // Bare invocation: show banner (once per session) + condensed welcome
      if (isWelcome) {
        if (isQuiet) {
          process.exit(0);
        }
        if (!suppressBanner) {
          await printBanner({
            version: pkg.version,
            repository: normalizeRepositoryUrl(pkg.repository),
          });
        }
        process.stdout.write(welcomeScreen() + "\n");
        const notice = getUpdateNotice(pkg.version);
        if (notice) process.stderr.write(chalk.dim(notice) + "\n");
        process.exit(0);
      }

      const commanderCode = (err as { code?: string }).code;
      if (captureMachineOutput) {
        if (commanderCode === "commander.version") {
          const versionLine = machineCapturedOut.trim();
          printJsonSuccess({
            mode: "version",
            version: versionLine || pkg.version,
          });
        } else {
          printJsonSuccess({
            mode: "help",
            help: machineCapturedOut.trimEnd(),
          });
        }
      } else if (isMachineMode) {
        if (commanderCode === "commander.version") {
          printJsonSuccess({
            mode: "version",
            version: pkg.version,
          });
        } else {
          printJsonSuccess({
            mode: "help",
            help: program.helpInformation().trimEnd(),
          });
        }
      }
      process.exit(0);
    }

    const mapped = mapCommanderError(err);
    if (mapped) {
      if (isMachineMode) {
        printError(mapped, true);
        return;
      }
      // In interactive mode, commander already printed a readable error/help.
      process.exit(EXIT_CODES.INPUT);
      return;
    }

    printError(err, isMachineMode);
  }
})();
