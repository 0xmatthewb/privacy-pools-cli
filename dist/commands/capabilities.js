import { Command } from "commander";
import { printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderCapabilities } from "../output/capabilities.js";
const CAPABILITIES = {
    commands: [
        {
            name: "init",
            description: "Initialize wallet and configuration",
            flags: ["--mnemonic <phrase>", "--mnemonic-file <path>", "--private-key <key>", "--private-key-file <path>", "--default-chain <chain>", "--skip-circuits", "--force", "--show-mnemonic"],
            agentFlags: "--yes --json --default-chain <chain> --skip-circuits",
            requiresInit: false,
        },
        {
            name: "pools",
            description: "List available pools and assets",
            flags: ["--all-chains", "--search <query>", "--sort <mode>"],
            agentFlags: "--json [--all-chains] [--search <query>] [--sort <mode>]",
            requiresInit: false,
        },
        {
            name: "activity",
            description: "Show public activity feed (global or specific pool)",
            flags: ["--asset <symbol|address>", "--page <n>", "--limit <n>"],
            agentFlags: "--json [--asset <symbol>] [--page <n>] [--limit <n>]",
            requiresInit: false,
        },
        {
            name: "stats",
            description: "Show public statistics (global or per pool)",
            usage: "stats",
            flags: ["global", "pool --asset <symbol|address>"],
            agentFlags: "global --json | pool --asset <symbol> --json",
            requiresInit: false,
        },
        {
            name: "deposit",
            description: "Deposit ETH or ERC-20 tokens into a Privacy Pool",
            usage: "deposit <amount> --asset <symbol|address>",
            flags: ["--asset <symbol|address>", "--unsigned", "--unsigned-format <envelope|tx>", "--dry-run"],
            agentFlags: "--json --yes --asset <symbol>",
            requiresInit: true,
        },
        {
            name: "withdraw",
            description: "Withdraw from a Privacy Pool (relayed by default)",
            usage: "withdraw <amount> --asset <symbol|address> --to <address>",
            flags: ["--asset <symbol|address>", "--to <address>", "--from-pa <PA-#>", "--direct", "--unsigned", "--unsigned-format <envelope|tx>", "--dry-run"],
            agentFlags: "--json --yes --asset <symbol> --to <address>",
            requiresInit: true,
        },
        {
            name: "balance",
            description: "Show balances across pools",
            flags: ["--no-sync"],
            agentFlags: "--json",
            requiresInit: true,
        },
        {
            name: "accounts",
            description: "List your Pool Accounts (PA-1, PA-2, ...)",
            flags: ["--no-sync", "--all", "--details"],
            agentFlags: "--json",
            requiresInit: true,
        },
        {
            name: "history",
            description: "Show chronological event history (deposits, withdrawals, exits)",
            flags: ["--no-sync", "--limit <n>"],
            agentFlags: "--json",
            requiresInit: true,
        },
        {
            name: "sync",
            description: "Sync local account state from on-chain events",
            flags: [],
            agentFlags: "--json",
            requiresInit: true,
        },
        {
            name: "status",
            description: "Show configuration and connection status",
            flags: [],
            agentFlags: "--json",
            requiresInit: false,
        },
        {
            name: "ragequit",
            aliases: ["exit"],
            description: "Publicly withdraw funds without ASP approval (reveals deposit link)",
            usage: "ragequit --asset <symbol|address> --from-pa <PA-#>",
            flags: ["--asset <symbol|address>", "--from-pa <PA-#>", "--unsigned", "--unsigned-format <envelope|tx>", "--dry-run"],
            agentFlags: "--json --yes --asset <symbol> --from-pa <PA-#>",
            requiresInit: true,
        },
        {
            name: "guide",
            description: "Show usage guide, workflow, and reference",
            flags: [],
            agentFlags: "--json",
            requiresInit: false,
        },
        {
            name: "completion",
            description: "Generate shell completion scripts",
            flags: ["[shell]", "--shell <shell>", "--query", "--cword <index>"],
            agentFlags: "--json <shell>",
            requiresInit: false,
        },
        {
            name: "capabilities",
            description: "Describe CLI capabilities for agent discovery",
            flags: [],
            agentFlags: "--json",
            requiresInit: false,
        },
    ],
    globalFlags: [
        { flag: "-j, --json", description: "Machine-readable JSON output on stdout" },
        { flag: "-y, --yes", description: "Skip confirmation prompts" },
        { flag: "-c, --chain <name>", description: "Target chain (ethereum, sepolia, ...)" },
        { flag: "-r, --rpc-url <url>", description: "Override RPC URL" },
        { flag: "-q, --quiet", description: "Suppress non-essential stderr output" },
        { flag: "-v, --verbose", description: "Enable verbose/debug output" },
        { flag: "--no-banner", description: "Disable ASCII banner output" },
        { flag: "--agent", description: "Alias for --json --yes --quiet" },
    ],
    agentWorkflow: [
        "1. privacy-pools init --json --yes --default-chain <chain> --skip-circuits",
        "2. privacy-pools pools --json --chain <chain>",
        "3. privacy-pools deposit <amount> --asset <symbol> --json --yes --chain <chain>",
        "4. privacy-pools accounts --json --chain <chain>  (wait for aspStatus: approved)",
        "5. privacy-pools withdraw <amount> --asset <symbol> --to <address> --json --yes --chain <chain>",
    ],
    jsonOutputContract: "All commands emit { schemaVersion, success, ...payload } on stdout when --json is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage }.",
};
export function createCapabilitiesCommand() {
    return new Command("capabilities")
        .description("Describe CLI capabilities for agent discovery")
        .addHelpText("after", "\nExamples:\n  privacy-pools capabilities\n  privacy-pools capabilities --json\n"
        + commandHelpText({
            jsonFields: "{ commands[], globalFlags[], agentWorkflow[], jsonOutputContract }",
        }))
        .action(async (_opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        try {
            renderCapabilities(createOutputContext(mode), CAPABILITIES);
        }
        catch (error) {
            printError(error, mode.isJson);
        }
    });
}
