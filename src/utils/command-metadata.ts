import { CHAINS, CHAIN_NAMES } from "../config/chains.js";
import type { CapabilitiesPayload } from "../output/capabilities.js";
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

export interface CommandMetadata {
  description: string;
  aliases?: string[];
  help?: CommandHelpConfig;
  capabilities?: CommandCapabilityMetadata;
  safeReadOnly?: boolean;
  documentedInAgents?: boolean;
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
        "Privacy Pools uses two keys:",
        "  Recovery phrase: keeps your deposits private (generated during init)",
        "  Signer key:     pays gas and sends transactions (can be set later)",
        "  These are independent. Set the signer key via PRIVACY_POOLS_PRIVATE_KEY env var.",
      ],
      examples: [
        "privacy-pools init",
        "privacy-pools init --yes --default-chain mainnet",
        "privacy-pools init --force --yes --default-chain mainnet",
        "privacy-pools init --json --show-mnemonic",
        "privacy-pools init --mnemonic \"word ...\" --private-key 0x...",
      ],
      jsonFields:
        "{ defaultChain, signerKeySet, recoveryPhraseRedacted? | recoveryPhrase?, warning?, nextActions?: [{ command, reason, when, args?, options? }] }",
      agentWorkflowNotes: [
        "When generating a new recovery phrase in machine mode, pass --show-mnemonic and capture it immediately.",
      ],
    },
    capabilities: {
      flags: [
        "--mnemonic <phrase>",
        "--mnemonic-file <path>",
        "--private-key <key>",
        "--private-key-file <path>",
        "--default-chain <chain>",
        "--force",
        "--show-mnemonic",
      ],
      agentFlags: "--yes --json --default-chain <chain>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `init`",
  },
  pools: {
    description: "List available pools and assets",
    help: {
      examples: [
        "privacy-pools pools",
        "privacy-pools pools ETH",
        "privacy-pools pools BOLD --chain mainnet",
        "privacy-pools pools --all-chains --sort tvl-desc",
        "privacy-pools pools --search usdc --sort asset-asc",
        "privacy-pools pools --json --chain mainnet",
      ],
      jsonFields:
        "{ chain?, allChains?, chains?, search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, totalDepositsCount, totalDepositsValue, acceptedDepositsValue, pendingDepositsValue, ... }], warnings?, nextActions?: [{ command, reason, when, args?, options? }] }",
      agentWorkflowNotes: [
        "In pools JSON, 'asset' is the symbol for CLI follow-up commands and 'tokenAddress' is the contract address.",
      ],
    },
    capabilities: {
      flags: ["--all-chains", "--search <query>", "--sort <mode>"],
      agentFlags: "--json [--all-chains] [--search <query>] [--sort <mode>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,
    documentedInAgents: true,
    agentsDocMarker: "#### `pools`",
  },
  activity: {
    description: "Show public activity feed",
    help: {
      examples: [
        "privacy-pools activity",
        "privacy-pools activity --page 2 --limit 20",
        "privacy-pools activity --asset ETH",
        "privacy-pools activity --asset USDC --json --chain mainnet",
      ],
      jsonFields:
        "{ mode, chain, chains?, page, perPage, total, totalPages, chainFiltered?, note?, asset?, pool?, scope?, events: [{ type, txHash, explorerUrl, reviewStatus, amountRaw, amountFormatted, poolSymbol, poolAddress, chainId, timestamp }] }",
    },
    capabilities: {
      flags: ["--asset <symbol|address>", "--page <n>", "--limit <n>"],
      agentFlags: "--json [--asset <symbol>] [--page <n>] [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,
    documentedInAgents: true,
    agentsDocMarker: "#### `activity`",
  },
  stats: {
    description: "Show public statistics",
    help: {
      examples: [
        "privacy-pools stats global",
        "privacy-pools stats pool --asset ETH",
        "privacy-pools stats pool --asset USDC --json --chain mainnet",
      ],
    },
    capabilities: {
      usage: "stats",
      flags: ["global", "pool --asset <symbol|address>"],
      agentFlags: "global --json (or: pool --asset <symbol> --json)",
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
        "privacy-pools stats global --json",
      ],
      jsonFields:
        "{ mode, chain, chains?, cacheTimestamp?, allTime?, last24h?, perChain?: [{ chain, cacheTimestamp, allTime, last24h }] }",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `stats global`",
  },
  "stats pool": {
    description: "Show statistics for a specific pool (all-time and last 24h)",
    help: {
      examples: [
        "privacy-pools stats pool --asset ETH",
        "privacy-pools stats pool --asset USDC --json --chain mainnet",
      ],
      jsonFields: "{ mode, chain, asset, pool, scope, cacheTimestamp?, allTime?, last24h? }",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `stats pool`",
  },
  status: {
    description: "Show configuration and check connection health",
    help: {
      examples: [
        "privacy-pools status",
        "privacy-pools status --check",
        "privacy-pools status --no-check",
        "privacy-pools status --json --check-rpc",
        "privacy-pools status --chain mainnet --rpc-url https://...",
      ],
      jsonFields:
        "{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, nextActions?: [{ command, reason, when, args?, options? }], aspLive?, rpcLive?, rpcBlockNumber? }",
    },
    capabilities: {
      flags: ["--check", "--no-check", "--check-rpc", "--check-asp"],
      agentFlags: "--json [--no-check] [--check-rpc] [--check-asp]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
    documentedInAgents: true,
    agentsDocMarker: "#### `status`",
  },
  capabilities: {
    description: "Describe CLI capabilities for agent discovery",
    help: {
      examples: [
        "privacy-pools capabilities",
        "privacy-pools capabilities --json",
      ],
      jsonFields:
        "{ commands[], globalFlags[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], safeReadOnlyCommands[], jsonOutputContract }",
    },
    capabilities: {
      flags: [],
      agentFlags: "--json",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
    documentedInAgents: true,
    agentsDocMarker: "#### `capabilities`",
  },
  guide: {
    description: "Show usage guide, workflow, and reference",
    capabilities: {
      flags: [],
      agentFlags: "--json",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  deposit: {
    description: "Deposit into a pool",
    help: {
      examples: [
        "privacy-pools deposit 0.1 ETH",
        "privacy-pools deposit 0.05 ETH --json --yes",
        "privacy-pools deposit 0.05 ETH --unsigned",
        "privacy-pools deposit 0.1 ETH --dry-run",
        "privacy-pools deposit 0.1 ETH --chain mainnet",
        "privacy-pools deposit 0.1 --asset ETH",
      ],
      prerequisites: "init",
      jsonFields:
        "{ operation, txHash, amount, committedValue, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber, explorerUrl, nextActions?: [{ command, reason, when, args?, options? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, precommitment, transactions[] }",
        "--unsigned --unsigned-format tx: [{ to, data, value, valueHex, chainId }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, precommitment, balanceSufficient }",
      ],
      safetyNotes: [
        "Deposits are reviewed by the ASP before approval. Most approve within 1 hour; some may take up to 7 days.",
        "A vetting fee is deducted from the deposit amount by the pool's ASP.",
        "Only approved deposits can be withdrawn privately.",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "Poll accounts until aspStatus is approved before attempting a private withdrawal.",
      ],
    },
    capabilities: {
      usage: "deposit <amount> --asset <symbol|address>",
      flags: [
        "--asset <symbol|address>",
        "--unsigned",
        "--unsigned-format <envelope|tx>",
        "--dry-run",
      ],
      agentFlags: "--json --yes",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `deposit`",
  },
  withdraw: {
    description: "Withdraw from a pool",
    help: {
      examples: [
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient... -p PA-2",
        "privacy-pools withdraw --all ETH --to 0xRecipient...",
        "privacy-pools withdraw 50% ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.1 ETH --to 0xRecipient... --dry-run",
        "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient... --chain mainnet",
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Direct withdrawals are not privacy-preserving. Use relayed mode (default) for private withdrawals.",
      ],
      jsonFields:
        "{ operation, mode, txHash, blockNumber, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS, extraGas?, remainingBalance, nextActions?: [{ command, reason, when, args?, options? }] }",
      jsonVariants: [
        "direct: same fields but mode: \"direct\", fee: null instead of feeBPS, no extraGas, and human output explains the onchain link between deposit and withdrawal.",
        "quote: { mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions?: [{ command, reason, when, args?, options? }] }",
        "--unsigned: { mode, operation, withdrawMode, chain, transactions[], ... }",
        "--unsigned --unsigned-format tx: [{ to, data, value, valueHex, chainId }]",
        "--dry-run: { mode, dryRun, amount, asset, chain, recipient, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, feeBPS?, quoteExpiresAt?, extraGas? }",
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
        "--unsigned",
        "--unsigned-format <envelope|tx>",
        "--dry-run",
      ],
      agentFlags: "--json --yes",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `withdraw`",
  },
  "withdraw quote": {
    description: "Request relayer quote and limits without generating a proof",
    help: {
      examples: [
        "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        "privacy-pools withdraw quote 100 USDC --json --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions?: [{ command, reason, when, args?, options? }] }",
      agentWorkflowNotes: [
        "Quotes expire quickly; submit the withdrawal promptly after quoting if the fee is acceptable.",
      ],
    },
    capabilities: {
      usage: "withdraw quote <amount> --asset <symbol|address>",
      flags: ["--asset <symbol|address>", "--to <address>"],
      agentFlags: "--json",
      requiresInit: true,
      expectedLatencyClass: "medium",
    },
    documentedInAgents: true,
    agentsDocMarker: "**Withdrawal quote:**",
  },
  ragequit: {
    description: "Publicly withdraw funds to your deposit address",
    aliases: ["exit"],
    help: {
      overview: [
        "Use 'withdraw' to withdraw privately once your deposit is ASP-approved.",
        "Use 'ragequit' at any time to recover funds publicly to your deposit",
        "address, even if not approved. No ASP approval is needed, but your",
        "deposit address is revealed onchain. 'exit' is an alias.",
      ],
      examples: [
        "privacy-pools ragequit ETH -p PA-1",
        "privacy-pools ragequit ETH --unsigned -p PA-1",
        "privacy-pools ragequit ETH --dry-run -p PA-1",
        "privacy-pools ragequit ETH -p PA-1 --chain mainnet",
        "privacy-pools ragequit --asset ETH -p PA-1",
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Ragequit is public and irreversible and reveals the original deposit address onchain.",
      ],
      jsonFields:
        "{ operation, txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber, explorerUrl, nextActions?: [{ command, reason, when, args?, options? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, transactions[] }",
        "--unsigned --unsigned-format tx: [{ to, data, value, valueHex, chainId }]",
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
        "--unsigned",
        "--unsigned-format <envelope|tx>",
        "--dry-run",
      ],
      agentFlags: "--json --yes",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `ragequit`",
  },
  accounts: {
    description: "List your Pool Accounts (individual deposit lineages) with balances",
    help: {
      examples: [
        "privacy-pools accounts",
        "privacy-pools accounts --all",
        "privacy-pools accounts --details",
        "privacy-pools accounts --json",
        "privacy-pools accounts --no-sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash, explorerUrl }], balances: [{ asset, balance, usdValue, poolAccounts }], pendingCount, nextActions?: [{ command, reason, when, args?, options? }] }",
    },
    capabilities: {
      flags: ["--no-sync", "--all", "--details"],
      agentFlags: "--json",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `accounts`",
  },
  history: {
    description: "Show chronological event history (deposits, withdrawals, ragequits)",
    help: {
      examples: [
        "privacy-pools history",
        "privacy-pools history --limit 10",
        "privacy-pools history --json",
        "privacy-pools history --no-sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }] }",
    },
    capabilities: {
      flags: ["--no-sync", "--limit <n>"],
      agentFlags: "--json",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `history`",
  },
  sync: {
    description: "Force-sync local account state from onchain events",
    help: {
      examples: [
        "privacy-pools sync",
        "privacy-pools sync --asset ETH --json",
        "privacy-pools sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, syncedPools, availablePoolAccounts, syncedSymbols?, previousAvailablePoolAccounts? }",
    },
    capabilities: {
      flags: ["-a, --asset <symbol|address>"],
      agentFlags: "--json [--asset <symbol>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    documentedInAgents: true,
    agentsDocMarker: "#### `sync`",
  },
  completion: {
    description: "Generate shell completion script",
    help: {
      overview: [
        "Generated scripts register both privacy-pools and pp.",
      ],
      examples: [
        "privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools",
        "privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools",
        "privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish",
      ],
      jsonFields: "{ mode, shell, completionScript }",
    },
    capabilities: {
      flags: ["[shell]", "--shell <shell>"],
      agentFlags: "--json <shell>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
};

export const COMMAND_PATHS = Object.keys(COMMAND_METADATA) as CommandPath[];

export const CAPABILITIES_COMMAND_ORDER: CommandPath[] = [
  "init",
  "pools",
  "activity",
  "stats",
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
  "1. privacy-pools init --json --yes --default-chain <chain>",
  "2. privacy-pools pools --json --chain <chain>",
  "3. privacy-pools deposit <amount> --asset <symbol> --json --yes --chain <chain>",
  "4. privacy-pools accounts --json --chain <chain>  (poll until aspStatus: approved)",
  "5. privacy-pools withdraw <amount> --asset <symbol> --to <address> --json --yes --chain <chain>",
];

const AGENT_NOTES: Record<string, string> = {
  polling:
    "After depositing, poll 'accounts --json' to check aspStatus. Most deposits are approved within 1 hour; some may take up to 7 days. Do not attempt withdrawal until aspStatus is 'approved'.",
  withdrawQuote:
    "Use 'withdraw quote <amount> --asset <symbol> --json' to check relayer fees before committing to a withdrawal.",
  firstRun:
    "First proof generation may provision checksum-verified circuit artifacts automatically (~60s one-time). Subsequent proofs are faster (~10-30s).",
  unsignedMode:
    "--unsigned builds transaction payloads without signing or submitting. Requires init (recovery phrase) for deposit secret generation, but does NOT require a signer key. The 'from' field is null; the signing party fills in their own address.",
  metaFlag:
    "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
  statusCheck:
    "Run 'status --json' before transacting. Check readyForDeposit/readyForWithdraw/readyForUnsigned fields.",
};

const CAPABILITIES_SCHEMAS: Record<string, Record<string, unknown>> = {
  aspApprovalStatus: {
    values: ["approved", "pending", "unknown"],
    description:
      "ASP approval status for a Pool Account. 'approved' means the deposit has been vetted and is eligible for private withdrawal. 'pending' means the ASP has not yet approved the deposit. 'unknown' applies to exited or spent accounts.",
  },
  poolAccountStatus: {
    values: ["spendable", "spent", "exited"],
    description:
      "Lifecycle status of a Pool Account. 'spendable' means funds are available. 'spent' means withdrawn. 'exited' means ragequit/exit was used.",
  },
  errorCategories: {
    values: ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"],
    exitCodes: { INPUT: 2, RPC: 3, ASP: 4, RELAYER: 5, PROOF: 6, CONTRACT: 7, UNKNOWN: 1 },
    description:
      "Error responses include: errorCode (machine-readable), category, message, hint (suggested fix), retryable (boolean).",
  },
  unsignedOutput: {
    envelopeFormat:
      "{ schemaVersion, success, mode, operation, chain, transactions: [{ to, data, value, ... }], ... }",
    txFormat:
      "[{ to, data, value, valueHex, chainId }]: raw array, no envelope wrapper. Intended for direct piping to signing tools.",
    note:
      "Default --unsigned emits the envelope format. Use --unsigned-format tx for raw transaction array only.",
  },
  nextActions: {
    shape:
      "{ command, reason, when, args?: string[], options?: Record<string, string|number|boolean|null> }",
    description:
      "Canonical workflow guidance for agents. Follow these command suggestions instead of parsing natural-language output.",
  },
};

export function getCommandMetadata(path: CommandPath): CommandMetadata {
  return COMMAND_METADATA[path];
}

export function getCommandDescription(path: CommandPath): string {
  return getCommandMetadata(path).description;
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
      if (!metadata.capabilities) {
        throw new Error(`Missing capabilities metadata for command path '${path}'.`);
      }

      return {
        name: metadata.capabilities.name ?? path,
        description: metadata.description,
        aliases: metadata.aliases,
        usage: metadata.capabilities.usage,
        flags: metadata.capabilities.flags,
        agentFlags: metadata.capabilities.agentFlags,
        requiresInit: metadata.capabilities.requiresInit,
        expectedLatencyClass: metadata.capabilities.expectedLatencyClass,
      };
    }),
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
      "All commands emit { schemaVersion, success, ...payload } on stdout when --json is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, category, hint, retryable }. Exception: --unsigned-format tx emits a raw transaction array without the envelope.",
  };
}
