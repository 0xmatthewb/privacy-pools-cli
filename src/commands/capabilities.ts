import { Command } from "commander";
import { printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderCapabilities, type CapabilitiesPayload } from "../output/capabilities.js";
import { CHAINS, CHAIN_NAMES } from "../config/chains.js";

const CAPABILITIES: CapabilitiesPayload = {
  commands: [
    {
      name: "init",
      description: "Set up wallet and configuration",
      flags: ["--mnemonic <phrase>", "--mnemonic-file <path>", "--private-key <key>", "--private-key-file <path>", "--default-chain <chain>", "--force", "--show-mnemonic"],
      agentFlags: "--yes --json --default-chain <chain>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    {
      name: "pools",
      description: "List available pools and assets",
      flags: ["--all-chains", "--search <query>", "--sort <mode>"],
      agentFlags: "--json [--all-chains] [--search <query>] [--sort <mode>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    {
      name: "activity",
      description: "Show public activity feed",
      flags: ["--asset <symbol|address>", "--page <n>", "--limit <n>"],
      agentFlags: "--json [--asset <symbol>] [--page <n>] [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    {
      name: "stats",
      description: "Show public statistics",
      usage: "stats",
      flags: ["global", "pool --asset <symbol|address>"],
      agentFlags: "global --json (or: pool --asset <symbol> --json)",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    {
      name: "deposit",
      description: "Deposit into a pool",
      usage: "deposit <amount> --asset <symbol|address>",
      flags: ["--asset <symbol|address>", "--unsigned", "--unsigned-format <envelope|tx>", "--dry-run"],
      agentFlags: "--json --yes",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    {
      name: "withdraw",
      description: "Withdraw from a pool",
      usage: "withdraw <amount> --asset <symbol|address> --to <address>",
      flags: ["--asset <symbol|address>", "--to <address>", "--from-pa <PA-#>", "--direct", "--unsigned", "--unsigned-format <envelope|tx>", "--dry-run"],
      agentFlags: "--json --yes",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    {
      name: "withdraw quote",
      description: "Request relayer fee quote without generating a proof",
      usage: "withdraw quote <amount> --asset <symbol|address>",
      flags: ["--asset <symbol|address>", "--to <address>"],
      agentFlags: "--json",
      requiresInit: true,
      expectedLatencyClass: "medium",
    },
    {
      name: "accounts",
      description: "List your Pool Accounts (individual deposit lineages) with balances",
      flags: ["--no-sync", "--all", "--details"],
      agentFlags: "--json",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    {
      name: "history",
      description: "Show chronological event history (deposits, withdrawals, exits)",
      flags: ["--no-sync", "--limit <n>"],
      agentFlags: "--json",
      requiresInit: true,
      expectedLatencyClass: "medium",
    },
    {
      name: "sync",
      description: "Force-sync local account state (usually automatic)",
      flags: ["-a, --asset <symbol|address>"],
      agentFlags: "--json [--asset <symbol>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    {
      name: "status",
      description: "Show configuration and check connection health (checks run by default)",
      flags: ["--check", "--no-check", "--check-rpc", "--check-asp"],
      agentFlags: "--json [--no-check] [--check-rpc] [--check-asp]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    {
      name: "ragequit",
      aliases: ["exit"],
      description: "Publicly withdraw funds to your deposit address",
      usage: "ragequit --asset <symbol|address> --from-pa <PA-#>",
      flags: ["--asset <symbol|address>", "--from-pa <PA-#>", "--unsigned", "--unsigned-format <envelope|tx>", "--dry-run"],
      agentFlags: "--json --yes",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    {
      name: "guide",
      description: "Show usage guide, workflow, and reference",
      flags: [],
      agentFlags: "--json",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    {
      name: "completion",
      description: "Generate shell completion scripts",
      flags: ["[shell]", "--shell <shell>", "--query", "--cword <index>"],
      agentFlags: "--json <shell>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    {
      name: "capabilities",
      description: "Describe CLI capabilities for agent discovery",
      flags: [],
      agentFlags: "--json",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  ],
  globalFlags: [
    { flag: "-j, --json", description: "Machine-readable JSON output on stdout" },
    { flag: "--format <fmt>", description: "Output format: table (default), csv, json" },
    { flag: "-y, --yes", description: "Skip confirmation prompts" },
    { flag: "-c, --chain <name>", description: "Target chain (mainnet, arbitrum, optimism, ...)" },
    { flag: "-r, --rpc-url <url>", description: "Override RPC URL" },
    { flag: "-q, --quiet", description: "Suppress non-essential stderr output" },
    { flag: "-v, --verbose", description: "Enable verbose/debug output" },
    { flag: "--no-banner", description: "Disable ASCII banner output" },
    { flag: "--no-color", description: "Disable colored output (also respects NO_COLOR env var)" },
    { flag: "--agent", description: "Alias for --json --yes --quiet" },
    { flag: "--timeout <seconds>", description: "Network/transaction timeout in seconds (default: 30)" },
  ],
  agentWorkflow: [
    "1. privacy-pools init --json --yes --default-chain <chain>",
    "2. privacy-pools pools --json --chain <chain>",
    "3. privacy-pools deposit <amount> --asset <symbol> --json --yes --chain <chain>",
    "4. privacy-pools accounts --json --chain <chain>  (poll until aspStatus: approved)",
    "5. privacy-pools withdraw <amount> --asset <symbol> --to <address> --json --yes --chain <chain>",
  ],
  agentNotes: {
    polling: "After depositing, poll 'accounts --json' to check aspStatus. Most deposits are approved within 1 hour; some may take up to 7 days. Do not attempt withdrawal until aspStatus is 'approved'.",
    withdrawQuote: "Use 'withdraw quote <amount> --asset <symbol> --json' to check relayer fees before committing to a withdrawal.",
    firstRun: "First proof generation downloads circuit artifacts automatically (~60s one-time). Subsequent proofs are faster (~10-30s).",
    unsignedMode: "--unsigned builds transaction payloads without signing or submitting. Requires init (mnemonic) for deposit secret generation, but does NOT require a signer key. The 'from' field is null; the signing party fills in their own address.",
    metaFlag: "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
    statusCheck: "Run 'status --json' before transacting. Check readyForDeposit/readyForWithdraw/readyForUnsigned fields.",
  },
  schemas: {
    aspApprovalStatus: {
      values: ["approved", "pending", "unknown"],
      description: "ASP approval status for a Pool Account. 'approved' means the deposit has been vetted and is eligible for private withdrawal. 'pending' means the ASP has not yet approved the deposit. 'unknown' applies to exited or spent accounts.",
    },
    poolAccountStatus: {
      values: ["spendable", "spent", "exited"],
      description: "Lifecycle status of a Pool Account. 'spendable' means funds are available. 'spent' means withdrawn. 'exited' means ragequit/exit was used.",
    },
    errorCategories: {
      values: ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"],
      exitCodes: { INPUT: 2, RPC: 3, ASP: 4, RELAYER: 5, PROOF: 6, CONTRACT: 7, UNKNOWN: 1 },
      description: "Error responses include: errorCode (machine-readable), category, message, hint (suggested fix), retryable (boolean).",
    },
    unsignedOutput: {
      envelopeFormat: "{ schemaVersion, success, mode, operation, chain, transactions: [{ to, data, value, ... }], ... }",
      txFormat: "[{ to, data, value, valueHex, chainId }]: raw array, no envelope wrapper. Intended for direct piping to signing tools.",
      note: "Default --unsigned emits the envelope format. Use --unsigned-format tx for raw transaction array only.",
    },
  },
  supportedChains: CHAIN_NAMES.map((name) => ({
    name,
    chainId: CHAINS[name].id,
    testnet: CHAINS[name].isTestnet,
  })),
  safeReadOnlyCommands: ["pools", "activity", "stats", "status", "capabilities"],
  jsonOutputContract: "All commands emit { schemaVersion, success, ...payload } on stdout when --json is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, category, hint, retryable }. Exception: --unsigned-format tx emits a raw transaction array without the envelope.",
};

export function createCapabilitiesCommand(): Command {
  return new Command("capabilities")
    .description("Describe CLI capabilities for agent discovery")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools capabilities\n  privacy-pools capabilities --json\n"
        + commandHelpText({
          jsonFields: "{ commands[], globalFlags[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], jsonOutputContract }",
        })
    )
    .action(async (_opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);

      try {
        renderCapabilities(createOutputContext(mode), CAPABILITIES);
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
