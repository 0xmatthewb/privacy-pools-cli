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
import { CLIError, EXIT_CODES, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
// Load .env if present
loadEnv();
const argv = process.argv.slice(2);
function firstNonOptionToken(args) {
    const optionsWithValue = new Set(["--chain", "--rpc-url"]);
    for (let i = 0; i < args.length; i++) {
        const token = args[i];
        if (!token.startsWith("-"))
            return token;
        if (optionsWithValue.has(token))
            i++;
    }
    return undefined;
}
const firstCommandToken = firstNonOptionToken(argv);
const isJson = argv.includes("--json");
const isAgent = argv.includes("--agent");
const isQuiet = argv.includes("--quiet");
const isUnsigned = argv.includes("--unsigned");
const isDryRun = argv.includes("--dry-run");
const isMachineMode = isJson || isUnsigned || isDryRun || isAgent;
const isHelpLike = argv.includes("--help") || argv.includes("-h") || firstCommandToken === "help";
const isVersionLike = argv.includes("--version") || argv.includes("-V");
const noBanner = argv.includes("--no-banner");
const captureMachineOutput = isMachineMode && (isHelpLike || isVersionLike);
const shouldShowBanner = !isMachineMode && !isQuiet && !noBanner && !isHelpLike && !isVersionLike;
let machineCapturedOut = "";
const program = new Command();
program
    .name("privacy-pools")
    .description("CLI for interacting with Privacy Pools v1")
    .version(pkg.version)
    .option("--chain <name>", "Target chain (ethereum, sepolia, ...)")
    .option("--json", "Machine-readable JSON output")
    .option("--agent", "Agent-first mode (implies --json, --yes, and --quiet)")
    .option("--yes", "Skip confirmation prompts");
// Advanced options (kept available but hidden from root help to reduce noise)
program.addOption(new Option("--rpc-url <url>", "Override RPC URL").hideHelp());
program.addOption(new Option("--quiet", "Suppress non-essential output (agent-friendly)")
    .hideHelp());
program.addOption(new Option("--no-banner", "Disable ASCII banner output").hideHelp());
program.addOption(new Option("--verbose", "Enable verbose output").hideHelp());
// Show only command names in root help (no argument signatures)
program.configureHelp({
    subcommandTerm(cmd) {
        return cmd.name();
    },
});
if (!isMachineMode) {
    program.showSuggestionAfterError(true);
    program.showHelpAfterError(chalk.dim("\nUse --help to see usage and examples."));
}
else {
    program.showSuggestionAfterError(false);
    program.showHelpAfterError(false);
}
program.configureOutput({
    writeOut: (str) => {
        if (captureMachineOutput) {
            machineCapturedOut += str;
            return;
        }
        const styled = styleCommanderHelp(str);
        process.stdout.write(styled);
    },
    writeErr: (str) => {
        if (!isMachineMode)
            process.stderr.write(str);
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
program.addCommand(createWithdrawCommand());
program.addCommand(createBalanceCommand());
program.addCommand(createSyncCommand());
program.addCommand(createStatusCommand());
program.addCommand(createAccountsCommand());
program.addCommand(createRagequitCommand());
program.addCommand(createGuideCommand());
if (isMachineMode) {
    const applyMachineMode = (cmd) => {
        cmd.showSuggestionAfterError(false);
        cmd.showHelpAfterError(false);
        cmd.configureOutput({
            writeOut: (str) => {
                if (captureMachineOutput) {
                    machineCapturedOut += str;
                    return;
                }
                const styled = styleCommanderHelp(str);
                process.stdout.write(styled);
            },
            writeErr: () => { },
            outputError: () => { },
        });
        cmd.exitOverride();
        for (const sub of cmd.commands) {
            applyMachineMode(sub);
        }
    };
    applyMachineMode(program);
}
function mapCommanderError(error) {
    if (typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        typeof error.code !== "string") {
        return null;
    }
    const code = error.code;
    const rawMessage = error.message;
    const message = typeof rawMessage === "string" ? rawMessage : "Invalid command input.";
    if (code.startsWith("commander.")) {
        const normalized = message.replace(/^error:\s*/i, "").trim();
        return new CLIError(normalized || "Invalid command input.", "INPUT", "Use --help to see usage and examples.");
    }
    return null;
}
(async () => {
    try {
        if (shouldShowBanner) {
            await printBanner();
        }
        await program.parseAsync();
        if (isMachineMode &&
            !isHelpLike &&
            !isVersionLike &&
            firstCommandToken === undefined) {
            printJsonSuccess({
                mode: "help",
                help: program.helpInformation().trimEnd(),
            });
        }
    }
    catch (err) {
        // commander.* help/version under exitOverride
        if (typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err.code === "commander.help" ||
                err.code === "commander.helpDisplayed" ||
                err.code === "commander.version")) {
            const commanderCode = err.code;
            if (captureMachineOutput) {
                if (commanderCode === "commander.version") {
                    const versionLine = machineCapturedOut.trim();
                    printJsonSuccess({
                        mode: "version",
                        version: versionLine || pkg.version,
                    });
                }
                else {
                    printJsonSuccess({
                        mode: "help",
                        help: machineCapturedOut.trimEnd(),
                    });
                }
            }
            else if (isMachineMode) {
                if (commanderCode === "commander.version") {
                    printJsonSuccess({
                        mode: "version",
                        version: pkg.version,
                    });
                }
                else {
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
