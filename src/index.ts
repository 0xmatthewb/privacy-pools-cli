#!/usr/bin/env node

import { Command, Option } from "commander";
import { config as loadEnv } from "dotenv";
import chalk from "chalk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
import { createInitCommand } from "./commands/init.js";
import { createStatusCommand } from "./commands/status.js";
import { createPoolsCommand } from "./commands/pools.js";
import { createActivityCommand } from "./commands/activity.js";
import { createStatsCommand } from "./commands/stats.js";
import { createDepositCommand } from "./commands/deposit.js";
import { createWithdrawCommand } from "./commands/withdraw.js";
import { createRagequitCommand } from "./commands/ragequit.js";
import { createAccountsCommand } from "./commands/accounts.js";
import { createSyncCommand } from "./commands/sync.js";
import { createGuideCommand } from "./commands/guide.js";
import { createHistoryCommand } from "./commands/history.js";
import { createCapabilitiesCommand } from "./commands/capabilities.js";
import { createCompletionCommand } from "./commands/completion.js";
import { printBanner } from "./utils/banner.js";
import { rootHelpFooter, styleCommanderHelp, welcomeScreen } from "./utils/help.js";
import { checkForUpdateInBackground, getUpdateNotice } from "./utils/update-check.js";
import { CLIError, EXIT_CODES, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";

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
checkForUpdateInBackground(pkg.version);

function hasShortFlag(args: string[], flag: string): boolean {
  for (const token of args) {
    if (!token.startsWith("-") || token.startsWith("--")) continue;
    if (token === `-${flag}`) return true;
    // Support bundled short flags, e.g. -jy or -qV
    if (/^-[A-Za-z]+$/.test(token) && token.includes(flag)) return true;
  }
  return false;
}

function firstNonOptionToken(args: string[]): string | undefined {
  const optionsWithValue = new Set(["-c", "--chain", "-r", "--rpc-url"]);
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("-")) return token;
    if (optionsWithValue.has(token)) i++;
  }
  return undefined;
}

const firstCommandToken = firstNonOptionToken(argv);
const formatFlagValue = (() => {
  const idx = argv.indexOf("--format");
  return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1].toLowerCase() : null;
})();
const isJson = argv.includes("--json") || hasShortFlag(argv, "j") || formatFlagValue === "json";
const isCsvMode = formatFlagValue === "csv";
const isAgent = argv.includes("--agent");
const isQuiet = argv.includes("--quiet") || hasShortFlag(argv, "q");
const isUnsigned = argv.includes("--unsigned");
const isMachineMode = isJson || isCsvMode || isUnsigned || isAgent;
const isHelpLike = argv.includes("--help") || hasShortFlag(argv, "h") || firstCommandToken === "help";
const isVersionLike = argv.includes("--version") || hasShortFlag(argv, "V");
const isCompletionLike = firstCommandToken === "completion";
const captureMachineOutput = isMachineMode && (isHelpLike || isVersionLike);
const isWelcome = argv.length === 0 && !isMachineMode;
let machineCapturedOut = "";

const program = new Command();

program
  .name("privacy-pools")
  .description(
    "Privacy Pools \u2014 a compliant way to transact privately on Ethereum"
  )
  .version(pkg.version)
  .option("-c, --chain <name>", "Target chain (mainnet, arbitrum, optimism, ...)")
  .option("-j, --json", "Machine-readable JSON output")
  .option("--format <format>", "Output format: table (default), csv, json")
  .option("-y, --yes", "Skip confirmation prompts");

// Advanced options
program.addOption(new Option("-r, --rpc-url <url>", "Override RPC URL").hideHelp());
program.addOption(
  new Option(
    "--agent",
    "Machine-friendly mode (alias for --json --yes --quiet)"
  )
);
program.addOption(
  new Option("-q, --quiet", "Suppress non-essential output (agent-friendly)")
    .hideHelp()
);
program.addOption(new Option("--no-banner", "Disable ASCII banner output").hideHelp());
program.addOption(new Option("-v, --verbose", "Enable verbose output").hideHelp());
program.addOption(new Option("--timeout <seconds>", "RPC/API request timeout in seconds (default: 30)"));
program.addOption(new Option("--no-color", "Disable colored output (also respects NO_COLOR env var)").hideHelp());

// Show only command names in root help (no argument signatures)
program.configureHelp({
  subcommandTerm(cmd) {
    const aliases = cmd.aliases();
    return aliases.length > 0 ? `${cmd.name()}|${aliases[0]}` : cmd.name();
  },
});

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
      write(chalk.red(str));
    }
  },
});
program.addHelpText("after", rootHelpFooter());
program.exitOverride();

// Commands ordered by typical workflow
program.addCommand(createInitCommand());
program.addCommand(createPoolsCommand());
program.addCommand(createDepositCommand());
program.addCommand(createAccountsCommand());
program.addCommand(createWithdrawCommand());
program.addCommand(createRagequitCommand());
program.addCommand(createHistoryCommand());
program.addCommand(createSyncCommand(), { hidden: true });
program.addCommand(createStatusCommand());
program.addCommand(createActivityCommand());
program.addCommand(createStatsCommand());
program.addCommand(createGuideCommand());
program.addCommand(createCapabilitiesCommand());
program.addCommand(createCompletionCommand(), { hidden: true });

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
        await printBanner();
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
