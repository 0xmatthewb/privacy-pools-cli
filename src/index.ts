#!/usr/bin/env node

import { Command, Option } from "commander";
import { config as loadEnv } from "dotenv";
import chalk from "chalk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
import { createInitCommand } from "./commands/init.js";
import { createStatusCommand } from "./commands/status.js";
import { createPoolsCommand } from "./commands/pools.js";
import { createDepositCommand } from "./commands/deposit.js";
import { createWithdrawCommand } from "./commands/withdraw.js";
import { createRagequitCommand } from "./commands/ragequit.js";
import { createBalanceCommand } from "./commands/balance.js";
import { createAccountsCommand } from "./commands/accounts.js";
import { createSyncCommand } from "./commands/sync.js";
import { createGuideCommand } from "./commands/guide.js";
import { printBanner } from "./utils/banner.js";
import { rootHelpFooter, styleCommanderHelp } from "./utils/help.js";
import { printError } from "./utils/errors.js";

// Load .env if present
loadEnv();

const program = new Command();

program
  .name("privacy-pools")
  .description("CLI for interacting with Privacy Pools v1")
  .version(pkg.version)
  .option("--chain <name>", "Target chain (ethereum, sepolia, ...)")
  .option("--json", "Machine-readable JSON output")
  .option("--yes", "Skip confirmation prompts");

// Power-user options: functional but hidden from root help
program.addOption(new Option("--rpc-url <url>", "Override RPC URL").hideHelp());
program.addOption(new Option("--quiet", "Suppress non-essential output (agent-friendly)").hideHelp());
program.addOption(new Option("--no-banner", "Disable ASCII banner output").hideHelp());
program.addOption(new Option("--verbose", "Enable verbose output").hideHelp());

// Show only command names in root help (no argument signatures)
program.configureHelp({
  subcommandTerm(cmd) {
    return cmd.name();
  },
});

program.showSuggestionAfterError(true);
program.showHelpAfterError(chalk.dim("\nUse --help to see usage and examples."));
program.configureOutput({
  writeOut: (str: string) => process.stdout.write(styleCommanderHelp(str)),
  writeErr: (str: string) => process.stderr.write(str),
  outputError: (str, write) => write(chalk.red(str)),
});
program.addHelpText("after", rootHelpFooter());

// Commands ordered by typical workflow
program.addCommand(createInitCommand());
program.addCommand(createPoolsCommand());
program.addCommand(createDepositCommand());
program.addCommand(createWithdrawCommand());
program.addCommand(createBalanceCommand());
program.addCommand(createSyncCommand());
program.addCommand(createStatusCommand());
program.addCommand(createAccountsCommand());
program.addCommand(createRagequitCommand());
program.addCommand(createGuideCommand());

// Show banner only for interactive command execution (not help/version/json/script mode)
const argv = process.argv.slice(2);
const isJson = argv.includes("--json");
const isQuiet = argv.includes("--quiet");
const isUnsigned = argv.includes("--unsigned");
const isDryRun = argv.includes("--dry-run");
const isHelpLike = argv.includes("--help") || argv.includes("-h") || argv[0] === "help";
const isVersionLike = argv.includes("--version") || argv.includes("-V");
const noBanner = argv.includes("--no-banner");
const shouldShowBanner = !isJson && !isQuiet && !isUnsigned && !isDryRun && !noBanner && !isHelpLike && !isVersionLike;

(async () => {
  if (shouldShowBanner) {
    await printBanner();
  }
  await program.parseAsync();
})().catch((err) => {
  printError(err, isJson);
});
