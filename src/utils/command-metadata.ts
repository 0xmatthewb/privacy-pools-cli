import { CHAINS, CHAIN_NAMES } from "../config/chains.js";
import type {
  CapabilitiesPayload,
  CommandLatencyClass,
  DetailedCommandDescriptor,
} from "../types.js";
import type { CommandHelpConfig } from "./help.js";

export type CommandPath =
  | "init"
  | "pools"
  | "activity"
  | "stats"
  | "stats global"
  | "stats pool"
  | "status"
  | "capabilities"
  | "describe"
  | "guide"
  | "deposit"
  | "withdraw"
  | "withdraw quote"
  | "ragequit"
  | "accounts"
  | "history"
  | "sync"
  | "completion";

type CapabilityEntry = CapabilitiesPayload["commands"][number];

interface CommandCapabilityMetadata
  extends Omit<CapabilityEntry, "name" | "description" | "aliases"> {
  name?: string;
}

interface CommandDescriptorSeed {
  description: string;
  aliases: string[];
  usage: string;
  flags: string[];
  globalFlags: string[];
  requiresInit: boolean;
  expectedLatencyClass: CommandLatencyClass;
  safeReadOnly: boolean;
  prerequisites: string[];
  examples: string[];
  jsonFields: string | null;
  jsonVariants: string[];
  safetyNotes: string[];
  supportsUnsigned: boolean;
  supportsDryRun: boolean;
  agentWorkflowNotes: string[];
}

export interface CommandMetadata {
  description: string;
  aliases?: string[];
  help?: CommandHelpConfig;
  capabilities?: CommandCapabilityMetadata;
  safeReadOnly?: boolean;
  agentsDocMarker?: string;
}

export interface GlobalFlagMetadata {
  flag: string;
  description: string;
}

export const COMMAND_METADATA: Record<CommandPath, CommandMetadata> = {
  init: {
    description: "Initialize wallet and configuration",
    help: {
      overview: [
        "Generates a BIP-39 mnemonic (used to derive deposit commitments) and a signer key (your onchain identity). Run once.",
        "",
        "Privacy Pools uses two keys:",
        "  Recovery phrase: keeps your deposits private (generated during init)",
        "  Signer key:     pays gas and sends transactions (can be set later)",
        "  These are independent. Set the signer key via PRIVACY_POOLS_PRIVATE_KEY env var.",
        "",
        "During interactive setup, init offers to write a recovery backup to ~/privacy-pools-recovery.txt. Use only one stdin secret source per invocation: either --mnemonic-stdin or --private-key-stdin. Circuit artifacts are provisioned automatically on first proof and cached under ~/.privacy-pools/circuits/.",
      ],
      examples: [
        "privacy-pools init",
        "privacy-pools init --yes --default-chain mainnet",
        "privacy-pools init --force --yes --default-chain mainnet",
        "privacy-pools init --agent --default-chain mainnet --show-mnemonic",
        "privacy-pools init --mnemonic \"word ...\" --private-key 0x...",
        "privacy-pools init --mnemonic-file ./my-mnemonic.txt --private-key-file ./my-key.txt",
        "cat phrase.txt | privacy-pools init --mnemonic-stdin --yes --default-chain mainnet",
      ],
      jsonFields:
        "{ defaultChain, signerKeySet, recoveryPhraseRedacted? | recoveryPhrase?, warning?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      safetyNotes: [
        "The recovery phrase and signer key are independent secrets: the phrase controls deposit privacy, the key pays gas. Neither is derived from the other.",
      ],
      agentWorkflowNotes: [
        "When generating a new recovery phrase in machine mode, pass --show-mnemonic and capture it immediately.",
      ],
    },
    capabilities: {
      flags: [
        "--mnemonic <phrase>",
        "--mnemonic-file <path>",
        "--mnemonic-stdin",
        "--private-key <key>",
        "--private-key-file <path>",
        "--private-key-stdin",
        "--default-chain <chain>",
        "--force",
        "--show-mnemonic",
      ],
      agentFlags: "--agent --default-chain <chain> --show-mnemonic",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    agentsDocMarker: "#### `init`",
  },
  pools: {
    description: "List available pools and assets",
    help: {
      overview: [
        "When no --chain is specified, shows all mainnet chains. Use --all-chains to include testnets. Pools are sorted by pool balance (highest first) by default. Pass a single asset symbol (e.g. 'pools ETH') for a detail view with your funds, recent activity, and pool stats.",
      ],
      examples: [
        "privacy-pools pools",
        "privacy-pools pools ETH",
        "privacy-pools pools BOLD --chain mainnet",
        "privacy-pools pools --all-chains --sort tvl-desc",
        "privacy-pools pools --search usdc --sort asset-asc",
        "privacy-pools pools --agent --chain mainnet",
      ],
      jsonFields:
        "{ chain?, allChains?, chains?, search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, totalDepositsCount, totalDepositsValue, acceptedDepositsValue, pendingDepositsValue, ... }], warnings? }",
      jsonVariants: [
        "detail (<asset>): { chain, asset, tokenAddress, pool, scope, ..., myFunds?, myFundsWarning?, recentActivity? }",
        "detail myFunds: { balance, usdValue, poolAccounts, pendingCount, poiRequiredCount, declinedCount, accounts: [{ id, status, aspStatus, value }] }",
      ],
      agentWorkflowNotes: [
        "In pools JSON, 'asset' is the symbol for CLI follow-up commands and 'tokenAddress' is the contract address.",
      ],
    },
    capabilities: {
      flags: ["--all-chains", "--search <query>", "--sort <mode>"],
      agentFlags: "--agent [--all-chains] [--search <query>] [--sort <mode>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `pools`",
  },
  activity: {
    description: "Show public activity feed",
    help: {
      examples: [
        "privacy-pools activity",
        "privacy-pools activity --page 2 --limit 20",
        "privacy-pools activity --asset ETH",
        "privacy-pools activity --asset USDC --agent --chain mainnet",
      ],
      jsonFields:
        "{ mode, chain, chains?, page, perPage, total, totalPages, chainFiltered?, note?, asset?, pool?, scope?, events: [{ type, txHash, explorerUrl, reviewStatus, amountRaw, amountFormatted, poolSymbol, poolAddress, chainId, timestamp }] }",
    },
    capabilities: {
      flags: ["--asset <symbol|address>", "--page <n>", "--limit <n>"],
      agentFlags: "--agent [--asset <symbol>] [--page <n>] [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `activity`",
  },
  stats: {
    description: "Show public statistics",
    help: {
      examples: [
        "privacy-pools stats global",
        "privacy-pools stats pool --asset ETH",
        "privacy-pools stats pool --asset USDC --agent --chain mainnet",
      ],
    },
    capabilities: {
      usage: "stats",
      flags: ["global", "pool --asset <symbol|address>"],
      agentFlags: "global --agent (or: pool --asset <symbol> --agent)",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,
  },
  "stats global": {
    description: "Show global Privacy Pools statistics (all-time and last 24h)",
    help: {
      examples: [
        "privacy-pools stats global",
        "privacy-pools stats global --agent",
      ],
      jsonFields:
        "{ mode, chain, chains?, cacheTimestamp?, allTime?, last24h?, perChain?: [{ chain, cacheTimestamp, allTime, last24h }] }",
    },
    capabilities: {
      usage: "stats global",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `stats global`",
  },
  "stats pool": {
    description: "Show statistics for a specific pool (all-time and last 24h)",
    help: {
      examples: [
        "privacy-pools stats pool --asset ETH",
        "privacy-pools stats pool --asset USDC --agent --chain mainnet",
      ],
      jsonFields: "{ mode, chain, asset, pool, scope, cacheTimestamp?, allTime?, last24h? }",
    },
    capabilities: {
      usage: "stats pool --asset <symbol|address>",
      flags: ["--asset <symbol|address>"],
      agentFlags: "--agent --asset <symbol>",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `stats pool`",
  },
  status: {
    description: "Show configuration and check connection health",
    help: {
      examples: [
        "privacy-pools status",
        "privacy-pools status --check",
        "privacy-pools status --no-check",
        "privacy-pools status --agent --check-rpc",
        "privacy-pools status --chain mainnet --rpc-url https://...",
      ],
      jsonFields:
        "{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, nextActions?: [{ command, reason, when, args?, options?, runnable? }], aspLive?, rpcLive?, rpcBlockNumber? }",
    },
    capabilities: {
      flags: ["--check", "--no-check", "--check-rpc", "--check-asp"],
      agentFlags: "--agent [--no-check] [--check-rpc] [--check-asp]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `status`",
  },
  capabilities: {
    description: "Describe CLI capabilities for agent discovery",
    help: {
      examples: [
        "privacy-pools capabilities",
        "privacy-pools capabilities --agent",
      ],
      jsonFields:
        "{ commands[], commandDetails{}, globalFlags[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], safeReadOnlyCommands[], jsonOutputContract, documentation?: { reference, agentGuide, changelog } }",
    },
    capabilities: {
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `capabilities`",
  },
  describe: {
    description: "Describe one command for runtime agent introspection",
    help: {
      overview: [
        "Useful when a human or agent wants the runtime contract for one command without parsing long-form docs. Accepts spaced command paths like 'withdraw quote' and 'stats global'.",
      ],
      examples: [
        "privacy-pools describe withdraw",
        "privacy-pools describe withdraw quote --agent",
        "privacy-pools describe stats global --agent",
      ],
      jsonFields:
        "{ command, description, aliases, usage, flags, globalFlags, requiresInit, expectedLatencyClass, safeReadOnly, prerequisites, examples, jsonFields, jsonVariants, safetyNotes, supportsUnsigned, supportsDryRun, agentWorkflowNotes }",
    },
    capabilities: {
      usage: "describe <command...>",
      flags: ["<command...>"],
      agentFlags: "--agent <command...>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `describe`",
  },
  guide: {
    description: "Show usage guide, workflow, and reference",
    help: {
      examples: [
        "privacy-pools guide",
        "privacy-pools guide --agent",
      ],
      jsonFields: "{ mode: \"help\", help }",
    },
    capabilities: {
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  deposit: {
    description: "Deposit into a pool",
    help: {
      overview: [
        "Deposits funds (ETH or ERC-20 tokens) into a Privacy Pool, creating a private commitment. A ZK proof is generated locally and the transaction is submitted onchain. The first run may download circuit files (~60s). Subsequent runs typically complete in 10-30s.",
        "",
        "Non-round deposit amounts can fingerprint your deposit in the anonymity set. The CLI warns and blocks deposits with excessive decimal precision (e.g. 1.276848 ETH), suggesting nearby round alternatives. Use --ignore-unique-amount to override.",
      ],
      examples: [
        "privacy-pools deposit 0.1 ETH",
        "privacy-pools deposit 100 USDC",
        "privacy-pools deposit 0.05 ETH --agent",
        "privacy-pools deposit 0.1 ETH --unsigned",
        "privacy-pools deposit 0.1 ETH --dry-run",
        "privacy-pools deposit 0.1 --asset ETH --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ operation, txHash, amount, committedValue, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber, explorerUrl, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, precommitment, transactions[] }",
        "--unsigned tx: [{ to, data, value, valueHex, chainId }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, precommitment, balanceSufficient }",
      ],
      safetyNotes: [
        "Deposits are reviewed by the ASP before approval. Most approve within 1 hour; some may take up to 7 days.",
        "A vetting fee is deducted from the deposit amount by the pool's ASP.",
        "Only approved deposits can use withdraw, whether relayed or direct. Declined deposits must use ragequit/exit publicly. Deposits that require Proof of Association (PoA) must complete the PoA flow at tornado.0xbow.io before they can withdraw privately.",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "Poll accounts --chain <chain> --pending-only while the Pool Account remains pending; when it disappears from pending results, re-run accounts --chain <chain> to confirm whether aspStatus became approved, declined, or requires Proof of Association. Withdraw only after approval; ragequit if declined; complete Proof of Association at tornado.0xbow.io first if needed. Always preserve the same --chain scope for both polling and confirmation.",
      ],
    },
    capabilities: {
      usage: "deposit <amount> --asset <symbol|address>",
      flags: [
        "--asset <symbol|address>",
        "--unsigned [envelope|tx]",
        "--dry-run",
        "--ignore-unique-amount",
      ],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `deposit`",
  },
  withdraw: {
    description: "Withdraw from a pool",
    help: {
      overview: [
        "Withdraws funds from a Privacy Pool via a relayer (default, recommended) for enhanced privacy. The relayer pays gas on your behalf and takes a small fee, keeping your withdrawal address unlinkable to your deposit. ASP approval is required before withdrawal. If a deposit is poi_required, complete Proof of Association at tornado.0xbow.io first. If it is declined, the recovery path is ragequit. Proof generation may take 10-30s. Use 'withdraw quote' to check relayer fees first.",
        "",
        "A --direct mode exists but is not recommended: it interacts with the pool contract directly, publicly linking your deposit and withdrawal addresses onchain. Prefer relayed withdrawals for privacy.",
        "",
        "Non-round withdrawal amounts may reduce privacy. The CLI suggests round alternatives.",
      ],
      examples: [
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient... --from-pa PA-2",
        "privacy-pools withdraw --all ETH --to 0xRecipient...",
        "privacy-pools withdraw 50% ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.1 ETH --to 0xRecipient... --dry-run",
        "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient... --chain mainnet",
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Always prefer relayed withdrawals (the default). Direct withdrawals (--direct) are NOT privacy-preserving: they publicly link your deposit address and withdrawal address onchain. Only use --direct if you understand and accept the privacy trade-off.",
        "ASP approval is required for both relayed and direct withdrawals. Declined deposits must ragequit publicly to the original deposit address.",
        "Relayed withdrawals must also respect the relayer minimum. If a withdrawal would leave a positive remainder below that minimum, the CLI warns so you can withdraw less, use --all/100%, or choose a public recovery path later.",
      ],
      jsonFields:
        "{ operation, mode, txHash, blockNumber, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS, extraGas?, remainingBalance, anonymitySet?: { eligible, total, percentage } }",
      jsonVariants: [
        "direct: same fields but mode: \"direct\", fee: null instead of feeBPS, no extraGas, and human output explains the onchain link between deposit and withdrawal.",
        "quote: { mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
        "--unsigned: { mode, operation, withdrawMode, chain, transactions[], ... }",
        "--unsigned tx: [{ to, data, value, valueHex, chainId }]",
        "--dry-run: { mode, dryRun, amount, asset, chain, recipient, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, feeBPS?, quoteExpiresAt?, extraGas?, anonymitySet?: { eligible, total, percentage } }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
    },
    capabilities: {
      usage: "withdraw <amount> --asset <symbol|address> --to <address>",
      flags: [
        "--asset <symbol|address>",
        "--to <address>",
        "--from-pa <PA-#>",
        "--all",
        "--direct",
        "--extra-gas",
        "--no-extra-gas",
        "--unsigned [envelope|tx]",
        "--dry-run",
      ],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `withdraw`",
  },
  "withdraw quote": {
    description: "Request relayer quote and limits without generating a proof",
    help: {
      examples: [
        "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        "privacy-pools withdraw quote 100 USDC --agent --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      agentWorkflowNotes: [
        "Quotes expire quickly; submit the withdrawal promptly after quoting if the fee is acceptable. Check runnable=false on nextActions for template commands that still need required user input.",
      ],
    },
    capabilities: {
      usage: "withdraw quote <amount> --asset <symbol|address>",
      flags: ["--asset <symbol|address>", "--to <address>"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "medium",
    },

    agentsDocMarker: "**Withdrawal quote:**",
  },
  ragequit: {
    description: "Publicly withdraw funds to your deposit address",
    aliases: ["exit"],
    help: {
      overview: [
        "Emergency withdrawal without ASP approval. The original depositor can publicly reclaim funds when the deposit label is not approved. Use 'withdraw' to withdraw privately once your deposit is ASP-approved. Use 'ragequit' at any time to recover funds publicly to your deposit address. Declined deposits must use this path; pending and poi_required deposits can also use it. Falls back to a built-in pool registry when public pool discovery is unavailable. 'exit' is an alias.",
      ],
      examples: [
        "privacy-pools ragequit ETH --from-pa PA-1",
        "privacy-pools ragequit ETH --unsigned --from-pa PA-1",
        "privacy-pools ragequit ETH --dry-run --from-pa PA-1",
        "privacy-pools ragequit ETH --from-pa PA-1 --chain mainnet",
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Ragequit is public and irreversible and reveals the original deposit address onchain.",
      ],
      jsonFields:
        "{ operation, txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber, explorerUrl }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, transactions[] }",
        "--unsigned tx: [{ to, data, value, valueHex, chainId }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
    },
    capabilities: {
      usage: "ragequit --asset <symbol|address> --from-pa <PA-#>",
      flags: [
        "--asset <symbol|address>",
        "--from-pa <PA-#>",
        "--unsigned [envelope|tx]",
        "--dry-run",
      ],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `ragequit`",
  },
  accounts: {
    description: "List your Pool Accounts (individual deposit lineages) with balances",
    help: {
      overview: [
        "Without --chain, accounts acts like a dashboard and aggregates your holdings across all mainnet chains. Use --all-chains to include testnets or --chain <name> to focus on one chain.",
        "",
        "Pool Account statuses: approved, pending, poi_required, declined, unknown, spent (fully withdrawn), exited (exit/ragequit).",
        "",
        "ASP statuses: approved (eligible for withdraw), pending (waiting for ASP), poi_required (complete Proof of Association at tornado.0xbow.io before withdraw), declined (cannot use withdraw; use ragequit), unknown.",
        "",
        "Compact modes --summary and --pending-only are intended for polling loops and do not support --details. When polling with --pending-only, Pool Accounts disappear from results when ASP review finishes. Re-run accounts without --pending-only to confirm whether the final status is approved, declined, or poi_required.",
      ],
      examples: [
        "privacy-pools accounts",
        "privacy-pools accounts --all-chains",
        "privacy-pools accounts --details",
        "privacy-pools accounts --summary",
        "privacy-pools accounts --chain <name> --pending-only",
        "privacy-pools accounts --agent",
        "privacy-pools accounts --no-sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, allChains?, chains?, warnings?, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash, explorerUrl, chain?, chainId? }], balances: [{ asset, balance, usdValue, poolAccounts, chain?, chainId? }], pendingCount, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      jsonVariants: [
        "--summary: { chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poiRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions? }",
        "--pending-only: { chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions? }",
      ],
      agentWorkflowNotes: [
        "Without --chain, accounts aggregates all mainnet chains by default. Use --all-chains to include testnets.",
        "Use --summary or --pending-only to reduce JSON size for polling loops.",
        "When a Pool Account disappears from --pending-only results, re-run accounts without --pending-only to confirm whether it was approved, declined, or requires Proof of Association (tornado.0xbow.io) before choosing withdraw or ragequit.",
      ],
    },
    capabilities: {
      flags: ["--no-sync", "--all-chains", "--details", "--summary", "--pending-only"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `accounts`",
  },
  history: {
    description: "Show chronological event history (deposits, withdrawals, ragequits)",
    help: {
      examples: [
        "privacy-pools history",
        "privacy-pools history --limit 10",
        "privacy-pools history --agent",
        "privacy-pools history --no-sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }] }",
    },
    capabilities: {
      flags: ["--no-sync", "--limit <n>"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `history`",
  },
  sync: {
    description: "Force-sync local account state from onchain events",
    help: {
      overview: [
        "Most commands auto-sync with a 2-minute freshness window. Use sync to force a refresh when you need the latest state immediately.",
      ],
      examples: [
        "privacy-pools sync",
        "privacy-pools sync --asset ETH --agent",
        "privacy-pools sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, syncedPools, availablePoolAccounts, syncedSymbols?, previousAvailablePoolAccounts? }",
    },
    capabilities: {
      flags: ["-a, --asset <symbol|address>"],
      agentFlags: "--agent [--asset <symbol>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `sync`",
  },
  completion: {
    description: "Generate shell completion script",
    help: {
      overview: [
        "Generated scripts register the privacy-pools command.",
        "",
        "Setup (add to your shell profile):",
        "  bash:  privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools",
        "  zsh:   privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools",
        "  fish:  privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish",
        "  pwsh:  privacy-pools completion powershell >> $PROFILE",
      ],
      examples: [
        "privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools",
        "privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools",
        "privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish",
        "privacy-pools completion powershell >> $PROFILE",
      ],
      jsonFields: "{ mode, shell, completionScript }",
    },
    capabilities: {
      flags: ["[shell]", "--shell <shell>"],
      agentFlags: "--agent <shell>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
};

export const COMMAND_PATHS = Object.keys(COMMAND_METADATA) as CommandPath[];

export const CAPABILITIES_COMMAND_ORDER: CommandPath[] = [
  "init",
  "pools",
  "activity",
  "stats",
  "stats global",
  "stats pool",
  "describe",
  "deposit",
  "withdraw",
  "withdraw quote",
  "accounts",
  "history",
  "sync",
  "status",
  "ragequit",
  "guide",
  "completion",
  "capabilities",
];

export const GLOBAL_FLAG_METADATA: GlobalFlagMetadata[] = [
  { flag: "-j, --json", description: "Machine-readable JSON output on stdout" },
  { flag: "--format <format>", description: "Output format: table (default), csv, json" },
  { flag: "-y, --yes", description: "Skip confirmation prompts" },
  { flag: "-c, --chain <name>", description: "Target chain (mainnet, arbitrum, optimism, ...)" },
  { flag: "-r, --rpc-url <url>", description: "Override RPC URL" },
  { flag: "-q, --quiet", description: "Suppress non-essential stderr output" },
  { flag: "-v, --verbose", description: "Enable verbose/debug output" },
  { flag: "--no-banner", description: "Disable ASCII banner output" },
  { flag: "--no-color", description: "Disable colored output (also respects NO_COLOR env var)" },
  { flag: "--agent", description: "Machine-friendly mode (alias for --json --yes --quiet)" },
  { flag: "--timeout <seconds>", description: "Network/transaction timeout in seconds (default: 30)" },
];

const AGENT_WORKFLOW = [
  "1. privacy-pools status --agent",
  "2. privacy-pools init --agent --default-chain <chain> --show-mnemonic",
  "3. privacy-pools pools --agent --chain <chain>",
  "4. privacy-pools deposit <amount> --asset <symbol> --agent --chain <chain>",
  "5. privacy-pools accounts --agent --chain <chain> --pending-only  (reviewed entries disappear; confirm approved vs declined vs poi_required with accounts --agent --chain <chain>)",
  "6. privacy-pools withdraw <amount> --asset <symbol> --to <address> --agent --chain <chain>",
];

const AGENT_NOTES: Record<string, string> = {
  polling:
    "After depositing, poll 'accounts --agent --chain <chain> --pending-only' while the Pool Account remains pending. Reviewed entries disappear from --pending-only results; once gone, re-run 'accounts --agent --chain <chain>' to confirm whether aspStatus is 'approved', 'declined', or 'poi_required'. Withdraw only after approval; ragequit if declined; complete Proof of Association at tornado.0xbow.io first if poi_required. Always preserve the same --chain scope for both polling and confirmation. Most deposits approve within 1 hour; some may take up to 7 days. Follow nextActions from the deposit response for the canonical polling command.",
  withdrawQuote:
    "Use 'withdraw quote <amount> --asset <symbol> --agent' to check relayer fees before committing to a withdrawal.",
  firstRun:
    "First proof generation may provision checksum-verified circuit artifacts automatically (~60s one-time). Subsequent proofs are faster (~10-30s).",
  unsignedMode:
    "--unsigned builds transaction payloads without signing or submitting. Use --unsigned tx for a raw transaction array (no envelope). Requires init (recovery phrase) for deposit secret generation, but does NOT require a signer key. The 'from' field is null; the signing party fills in their own address.",
  metaFlag:
    "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
  statusCheck:
    "Run 'status --agent' before transacting. readyForDeposit/readyForWithdraw/readyForUnsigned are configuration capability flags; they confirm the wallet is set up, NOT that withdrawable funds exist. Check 'accounts --agent --chain <chain>' to verify fund availability before withdrawing on a specific chain. Use bare 'accounts --agent' only for the default multi-chain mainnet dashboard.",
};

export const CAPABILITIES_SCHEMAS: Record<string, Record<string, unknown>> = {
  aspApprovalStatus: {
    values: ["approved", "pending", "poi_required", "declined", "unknown"],
    description:
      "ASP approval status for a Pool Account. 'approved' means the deposit has been vetted and is eligible for private withdrawal. 'pending' means the ASP has not yet approved the deposit. 'poi_required' means Proof of Association (tornado.0xbow.io) is required before private withdrawal. 'declined' means the ASP rejected the deposit for private withdrawal. 'unknown' applies to exited or spent accounts, or when ASP status could not be determined.",
  },
  poolAccountStatus: {
    values: ["approved", "pending", "poi_required", "declined", "unknown", "spent", "exited"],
    description:
      "User-facing status of a Pool Account. Active accounts surface their effective review state ('approved', 'pending', 'poi_required', 'declined', or 'unknown'). 'spent' means an approved account was withdrawn. 'exited' means ragequit/exit was used.",
  },
  errorCategories: {
    values: ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"],
    exitCodes: { INPUT: 2, RPC: 3, ASP: 4, RELAYER: 5, PROOF: 6, CONTRACT: 7, UNKNOWN: 1 },
    description:
      "Error responses include top-level errorCode/errorMessage plus error.{ code, category, message, hint?, retryable? }.",
  },
  unsignedOutput: {
    envelopeFormat:
      "{ schemaVersion, success, mode, operation, chain, transactions: [{ to, data, value, ... }], ... }",
    txFormat:
      "[{ to, data, value, valueHex, chainId }]: raw array, no envelope wrapper. Intended for direct piping to signing tools.",
    note:
      "Default --unsigned emits the envelope format. Use --unsigned tx for raw transaction array only.",
  },
  nextActions: {
    shape:
      "{ command, reason, when, args?: string[], options?: Record<string, string|number|boolean|null>, runnable?: boolean }",
    description:
      "Canonical workflow guidance for agents. Follow these command suggestions instead of parsing natural-language output. " +
      "Current nextActions are emitted only when the CLI has a low-ambiguity follow-up to recommend. " +
      "When runnable is omitted or true, the command is fully specified and can be executed as shown. " +
      "When runnable is false, the action is a template and requires additional user input before execution.",
  },
};

function descriptorSeed(path: CommandPath): CommandDescriptorSeed {
  const metadata = getCommandMetadata(path);
  const capabilities = metadata.capabilities;
  if (!capabilities) {
    throw new Error(`Missing capabilities metadata for command path '${path}'.`);
  }

  return {
    description: metadata.description,
    aliases: metadata.aliases ?? [],
    usage: capabilities.usage ?? path,
    flags: capabilities.flags ?? [],
    globalFlags: GLOBAL_FLAG_METADATA.map(({ flag }) => flag),
    requiresInit: capabilities.requiresInit,
    expectedLatencyClass: capabilities.expectedLatencyClass ?? "fast",
    safeReadOnly: metadata.safeReadOnly ?? false,
    prerequisites: metadata.help?.prerequisites ? [metadata.help.prerequisites] : [],
    examples: metadata.help?.examples ?? [],
    jsonFields: metadata.help?.jsonFields ?? null,
    jsonVariants: metadata.help?.jsonVariants ?? [],
    safetyNotes: metadata.help?.safetyNotes ?? [],
    supportsUnsigned: metadata.help?.supportsUnsigned ?? false,
    supportsDryRun: metadata.help?.supportsDryRun ?? false,
    agentWorkflowNotes: metadata.help?.agentWorkflowNotes ?? [],
  };
}

export function buildCommandDescriptor(path: CommandPath): DetailedCommandDescriptor {
  const seed = descriptorSeed(path);
  return {
    command: path,
    description: seed.description,
    aliases: seed.aliases,
    usage: seed.usage,
    flags: seed.flags,
    globalFlags: seed.globalFlags,
    requiresInit: seed.requiresInit,
    expectedLatencyClass: seed.expectedLatencyClass,
    safeReadOnly: seed.safeReadOnly,
    prerequisites: seed.prerequisites,
    examples: seed.examples,
    jsonFields: seed.jsonFields,
    jsonVariants: seed.jsonVariants,
    safetyNotes: seed.safetyNotes,
    supportsUnsigned: seed.supportsUnsigned,
    supportsDryRun: seed.supportsDryRun,
    agentWorkflowNotes: seed.agentWorkflowNotes,
  };
}

export function resolveCommandPath(query: string | string[]): CommandPath | null {
  const normalized = Array.isArray(query)
    ? query.join(" ").trim().replace(/\s+/g, " ")
    : query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if ((COMMAND_PATHS as string[]).includes(normalized)) {
    return normalized as CommandPath;
  }

  const aliasMatch = COMMAND_PATHS.find((path) =>
    (COMMAND_METADATA[path].aliases ?? []).includes(normalized)
  );
  return aliasMatch ?? null;
}

export function listCommandPaths(): CommandPath[] {
  return [...COMMAND_PATHS];
}

export function getCommandMetadata(path: CommandPath): CommandMetadata {
  return COMMAND_METADATA[path];
}

export function getDocumentedAgentMarkers(): string[] {
  return COMMAND_PATHS
    .map((path) => COMMAND_METADATA[path].agentsDocMarker)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function buildCapabilitiesPayload(): CapabilitiesPayload {
  return {
    commands: CAPABILITIES_COMMAND_ORDER.map((path) => {
      const metadata = getCommandMetadata(path);
      const seed = descriptorSeed(path);
      return {
        name: metadata.capabilities?.name ?? path,
        description: metadata.description,
        aliases: metadata.aliases,
        usage: seed.usage,
        flags: seed.flags,
        agentFlags: metadata.capabilities?.agentFlags,
        requiresInit: seed.requiresInit,
        expectedLatencyClass: seed.expectedLatencyClass,
      };
    }),
    commandDetails: Object.fromEntries(
      COMMAND_PATHS.map((path) => [path, buildCommandDescriptor(path)])
    ),
    globalFlags: GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({ flag, description })),
    agentWorkflow: AGENT_WORKFLOW,
    agentNotes: AGENT_NOTES,
    schemas: CAPABILITIES_SCHEMAS,
    supportedChains: CHAIN_NAMES.map((name) => ({
      name,
      chainId: CHAINS[name].id,
      testnet: CHAINS[name].isTestnet,
    })),
    safeReadOnlyCommands: COMMAND_PATHS
      .filter((path) => COMMAND_METADATA[path].safeReadOnly)
      .map((path) => path),
    jsonOutputContract:
      "All commands emit { schemaVersion, success, ...payload } on stdout when --json or --agent is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, error: { code, category, message, hint?, retryable? } }. Exception: --unsigned tx emits a raw transaction array without the envelope.",
    documentation: {
      reference: "docs/reference.md",
      agentGuide: "AGENTS.md",
      changelog: "CHANGELOG.md",
    },
  };
}
